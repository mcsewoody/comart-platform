from __future__ import annotations

import base64
import io
import mimetypes
import re
from pathlib import Path

import httpx
from openai import OpenAI
from openai.lib._pydantic import to_strict_json_schema
from PIL import Image

from .models import DocumentExtraction, ExtractedDocument
from .settings import Settings

SYSTEM_PROMPT = """
You extract structured product and document facts for an internal ODM/OEM
consumer-electronics knowledge system. Follow these rules:

1. A document may contain zero, one, or multiple products. Never invent a
   product for a non-product document.
2. Preserve original brand, model number and supplier names exactly. Do not
   translate or normalize them into a different legal entity.
3. Provide product names in original language, Traditional Chinese, English
   and Vietnamese. Translation is allowed only for descriptive names.
4. A filename, folder name, logo or email domain alone is not proof that an
   organization is the manufacturer. Set explicit_in_document=false and add a
   review reason whenever supplier identity or role is inferred.
5. First classify every product-like item using record_kind:
   - complete_product: a complete, independently identifiable sellable product.
   - product_variant: a configuration, color, decoration or capacity variant of
     a parent product; do not treat it as a separate product master.
   - design_asset: an appearance proposal, pattern, concept render, vote option,
     sketch or numbered design.
   - component: a part, PCBA, charging module, accessory or BOM-only item.
   - commercial_line_item: a quotation/cost row that does not independently
     prove a complete product.
   - product_candidate: product-like evidence that is too weak to create a
     product master.
   Only complete_product may become a product master.
6. A complete_product requires at least two independent identity_signals and
   is_complete_product=true. Filename/folder text, a logo, a BOM row, a price,
   or a decorative image alone never qualifies. At least one signal must be an
   explicit product name, model number or complete-product image, and another
   must describe function, specifications or show the complete product.
7. 2-in-1 versus 3-in-1 may be separate complete products only when the source
   proves complete configurations. Color, graphic, surface decoration and
   numbered appearance choices are product_variant or design_asset. Use a
   shared family_key to group related records.
8. Every model, supplier, dimension and commercial fact must have short,
   precise evidence with a page/slide/sheet/image locator.
9. Do not generate or imagine a product appearance.
   For representative_image, select only a real product image visible in the
   supplied page images. bbox_normalized is [x, y, width, height] from 0 to 1.
   Exclude unrelated products and keep the complete product in frame. Return
   null when no suitable real product image exists.
10. Use confidence conservatively. Conflicts between pages or sources must be
   listed in review_reasons.
11. Use original units and values. Prices belong in quote, never in the product
   master fields.
12. Explain record creation in creation_rationale. If evidence is insufficient,
    return product_candidate rather than guessing. It is valid to return zero
    complete products while still returning design assets or candidates.
""".strip()

DESIGN_SOURCE_PATTERN = re.compile(
    r"(?:design|deco|vote|外觀|外观|圖案|图案|概念|concept|render|sketch)", re.I
)
COMMERCIAL_SOURCE_PATTERN = re.compile(
    r"(?:\bbom\b|報價|报价|估價|估价|成本|cost|quotation|quote)", re.I
)
STRONG_IDENTITY_SIGNALS = {
    "explicit_product_name",
    "model_number",
    "complete_product_image",
    "function_description",
    "specification_set",
}


class ProductAnalyzer:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = (
            OpenAI(api_key=settings.openai_api_key)
            if settings.openai_api_key
            else None
        )

    @staticmethod
    def _image_content(path: str) -> dict[str, str]:
        mime = mimetypes.guess_type(path)[0] or "image/jpeg"
        payload = Path(path).read_bytes()
        try:
            with Image.open(path) as image:
                image = image.convert("RGB")
                image.thumbnail((1800, 1800))
                output = io.BytesIO()
                image.save(output, "JPEG", quality=82, optimize=True)
                payload = output.getvalue()
                mime = "image/jpeg"
        except OSError:
            pass
        encoded = base64.b64encode(payload).decode("ascii")
        return {
            "type": "input_image",
            "image_url": f"data:{mime};base64,{encoded}",
            "detail": "high",
        }

    def _proxy(self, payload: dict) -> dict:
        if not self.settings.ai_proxy_url:
            raise RuntimeError("CPF_AI_PROXY_URL is required without OPENAI_API_KEY")
        response = httpx.post(
            self.settings.ai_proxy_url,
            headers={
                "Authorization": (
                    f"Bearer {self.settings.supabase_service_role_key}"
                ),
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=360,
        )
        if response.is_error:
            raise RuntimeError(
                f"CPF AI proxy failed ({response.status_code}): {response.text[:1000]}"
            )
        return response.json()

    def _analyze_with_model(
        self,
        model: str,
        document: ExtractedDocument,
        source_name: str,
        previous: DocumentExtraction | None = None,
    ) -> tuple[DocumentExtraction, dict]:
        text = document.text[:120_000]
        prompt = (
            f"Source filename: {source_name}\n"
            f"Extracted text follows:\n{text or '[No extractable text; inspect images]'}"
        )
        if previous:
            prompt += (
                "\n\nA routine model produced this draft. Resolve uncertainty and "
                f"conflicts without adding unsupported facts:\n{previous.model_dump_json()}"
            )
        content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]
        content.extend(
            self._image_content(image_path)
            for image_path in document.image_paths[:8]
        )
        if self.client:
            response = self.client.responses.parse(
                model=model,
                input=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": content},
                ],
                text_format=DocumentExtraction,
                store=False,
            )
            if response.output_parsed is None:
                raise RuntimeError("OpenAI returned no parsed extraction")
            usage = response.usage.model_dump() if response.usage else {}
            return response.output_parsed, usage

        proxy_result = self._proxy(
            {
                "action": "analyze",
                "model": model,
                "systemPrompt": SYSTEM_PROMPT,
                "content": content,
                "schema": to_strict_json_schema(DocumentExtraction),
            }
        )
        return (
            DocumentExtraction.model_validate(proxy_result["extraction"]),
            proxy_result.get("usage") or {},
        )

    @staticmethod
    def enforce_creation_policy(
        extraction: DocumentExtraction,
        source_context: str,
    ) -> DocumentExtraction:
        review_reasons = list(extraction.review_reasons)
        design_source = bool(DESIGN_SOURCE_PATTERN.search(source_context))
        commercial_source = bool(COMMERCIAL_SOURCE_PATTERN.search(source_context))

        for product in extraction.products:
            original_kind = product.record_kind
            strong = set(product.identity_signals) & STRONG_IDENTITY_SIGNALS
            has_primary = bool(
                strong
                & {
                    "explicit_product_name",
                    "model_number",
                    "complete_product_image",
                }
            )
            has_secondary = bool(
                strong
                & {
                    "function_description",
                    "specification_set",
                    "complete_product_image",
                }
            )

            if product.record_kind == "complete_product" and (
                not product.is_complete_product
                or len(strong) < 2
                or not has_primary
                or not has_secondary
            ):
                product.record_kind = "product_candidate"

            if design_source and product.record_kind == "complete_product":
                proven_model_product = (
                    "model_number" in strong
                    and "complete_product_image" in strong
                    and "function_description" in strong
                )
                if not proven_model_product:
                    product.record_kind = "design_asset"

            if commercial_source and product.record_kind == "complete_product":
                proven_complete_product = (
                    "model_number" in strong
                    and "complete_product_image" in strong
                    and "function_description" in strong
                )
                if not proven_complete_product:
                    product.record_kind = "product_candidate"

            if product.record_kind == "product_variant" and not product.family_key:
                product.record_kind = "product_candidate"

            if product.record_kind != original_kind:
                reason = (
                    f"建立門檻覆核：{product.name_original} 從 {original_kind} "
                    f"調整為 {product.record_kind}；來源或證據不足以建立獨立產品主檔。"
                )
                review_reasons.append(reason)

        extraction.review_reasons = list(dict.fromkeys(review_reasons))
        return extraction

    def analyze(
        self,
        document: ExtractedDocument,
        source_name: str,
    ) -> tuple[DocumentExtraction, str, dict]:
        routine, routine_usage = self._analyze_with_model(
            self.settings.routine_model, document, source_name
        )
        routine = self.enforce_creation_policy(routine, source_name)
        if not routine.needs_escalation:
            return routine, self.settings.routine_model, {"routine": routine_usage}
        escalated, terra_usage = self._analyze_with_model(
            self.settings.escalation_model,
            document,
            source_name,
            previous=routine,
        )
        escalated = self.enforce_creation_policy(escalated, source_name)
        return (
            escalated,
            self.settings.escalation_model,
            {"routine": routine_usage, "escalation": terra_usage},
        )

    def embed(self, extraction: DocumentExtraction, extracted_text: str) -> list[float]:
        product_text = "\n".join(
            " ".join(
                [
                    product.name_original,
                    product.name_zh_tw,
                    product.name_en,
                    product.name_vi,
                    product.brand or "",
                    *product.model_numbers,
                    *product.functions,
                    *product.keywords,
                ]
            )
            for product in extraction.master_products
        )
        input_text = (
            f"{extraction.summary_zh_tw}\n{product_text}\n{extracted_text[:40_000]}"
        )
        if self.client:
            response = self.client.embeddings.create(
                model=self.settings.embedding_model,
                input=input_text,
                encoding_format="float",
            )
            return response.data[0].embedding
        result = self._proxy(
            {
                "action": "embed",
                "model": self.settings.embedding_model,
                "input": input_text,
            }
        )
        return result["embedding"]
