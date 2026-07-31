from __future__ import annotations

import base64
import io
import mimetypes
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
5. Split true variants (for example 2-in-1 and 3-in-1, or ID-001A/ID-001B)
   into separate products. Add a review reason so a human confirms the split.
6. Every model, supplier, dimension and commercial fact must have short,
   precise evidence with a page/slide/sheet/image locator.
7. Do not generate or imagine a product appearance.
   For representative_image, select only a real product image visible in the
   supplied page images. bbox_normalized is [x, y, width, height] from 0 to 1.
   Exclude unrelated products and keep the complete product in frame. Return
   null when no suitable real product image exists.
8. Use confidence conservatively. Conflicts between pages or sources must be
   listed in review_reasons.
9. Use original units and values. Prices belong in quote, never in the product
   master fields.
""".strip()


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

    def analyze(
        self,
        document: ExtractedDocument,
        source_name: str,
    ) -> tuple[DocumentExtraction, str, dict]:
        routine, routine_usage = self._analyze_with_model(
            self.settings.routine_model, document, source_name
        )
        if not routine.needs_escalation:
            return routine, self.settings.routine_model, {"routine": routine_usage}
        escalated, terra_usage = self._analyze_with_model(
            self.settings.escalation_model,
            document,
            source_name,
            previous=routine,
        )
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
            for product in extraction.products
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
