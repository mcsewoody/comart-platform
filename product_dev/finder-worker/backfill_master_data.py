from __future__ import annotations

import argparse
import json
import os
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

import httpx
from openai.lib._pydantic import to_strict_json_schema
from pydantic import BaseModel, Field
from supabase import create_client


class TaxonomyCategory(BaseModel):
    name_zh_tw: str
    name_en: str
    name_vi: str
    aliases: list[str] = Field(default_factory=list)
    description: str


class TaxonomyResult(BaseModel):
    categories: list[TaxonomyCategory]


class SupplierMapping(BaseModel):
    original_name: str
    role: Literal["manufacturer", "trader", "partner", "unknown"]
    explicit_in_document: bool
    confidence: float = Field(ge=0, le=1)
    evidence_excerpt: str = ""


class ProductMapping(BaseModel):
    product_id: str
    category_name_zh_tw: str
    category_confidence: float = Field(ge=0, le=1)
    category_rationale: str
    supplier: SupplierMapping | None = None


class MappingResult(BaseModel):
    mappings: list[ProductMapping]


SYSTEM_PROMPT = """
You maintain master data for an internal ODM/OEM consumer-electronics product
finder. Classify conservatively and preserve source evidence.

- Categories must be stable product types useful to sales and product managers,
  not project names, folder names, brands, model numbers, or vague themes.
- Use Traditional Chinese as the category authority and provide English and
  Vietnamese labels only as translations.
- Every product maps to exactly one supplied category.
- Supplier identity may only be returned from an extracted supplier candidate
  whose explicit_in_document field is true. Never infer a supplier from a brand,
  folder, filename, logo, email domain, or commercial context.
- Preserve supplier original_name exactly. Do not expand or invent a legal name.
- Use confidence conservatively and provide a short operational rationale.
""".strip()


def call_proxy(proxy_url: str, service_key: str, model: str, schema, prompt: str):
    response = httpx.post(
        proxy_url,
        headers={
            "apikey": service_key,
            "Content-Type": "application/json",
        },
        json={
            "action": "analyze",
            "model": model,
            "systemPrompt": SYSTEM_PROMPT,
            "content": [{"type": "input_text", "text": prompt}],
            "schema": to_strict_json_schema(schema),
        },
        timeout=360,
    )
    if response.is_error:
        raise RuntimeError(
            f"AI proxy failed ({response.status_code}): {response.text[:1000]}"
        )
    return schema.model_validate(response.json()["extraction"])


def normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def chunks(values: list[dict], size: int):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="AI-map reviewed CPF products to formal categories and explicit suppliers."
    )
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--model", default="gpt-5.6-terra")
    args = parser.parse_args()

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    proxy = os.getenv("CPF_AI_PROXY_URL", f"{url}/functions/v1/cpf-ai-worker")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    client = create_client(url, key)

    products = (
        client.table("cpf_products")
        .select(
            "id,name_original,name_zh_tw,name_en,name_vi,brand,model_numbers,"
            "functions,keywords,confirmation_status,category_id"
        )
        .eq("confirmation_status", "human_confirmed")
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    links = client.table("cpf_product_documents").select("product_id,document_id").execute().data or []
    documents = client.table("cpf_documents").select("id,title,source_path,current_version_id").execute().data or []
    versions = client.table("cpf_document_versions").select("id,analysis_result").execute().data or []
    document_map = {item["id"]: item for item in documents}
    version_map = {item["id"]: item for item in versions}
    product_documents: dict[str, list[str]] = defaultdict(list)
    for item in links:
        product_documents[item["product_id"]].append(item["document_id"])

    extracted_by_product: dict[str, dict] = {}
    for document in documents:
        result = (version_map.get(document.get("current_version_id")) or {}).get("analysis_result") or {}
        product_ids = result.get("productIds") or []
        extracted = result.get("products") or []
        for index, product_id in enumerate(product_ids):
            if index < len(extracted):
                extracted_by_product[str(product_id)] = extracted[index]

    ai_products: list[dict] = []
    for product in products:
        source_docs = [document_map[item] for item in product_documents[product["id"]] if item in document_map]
        extraction = extracted_by_product.get(product["id"], {})
        ai_products.append(
            {
                "id": product["id"],
                "name_original": product["name_original"],
                "name_zh_tw": product["name_zh_tw"],
                "brand": product.get("brand"),
                "model_numbers": product.get("model_numbers") or [],
                "functions": product.get("functions") or [],
                "keywords": product.get("keywords") or [],
                "source_documents": [
                    {"title": item["title"], "source_path": item["source_path"]}
                    for item in source_docs
                ],
                "extracted_supplier_candidates": extraction.get("suppliers") or [],
            }
        )

    existing_categories = (
        client.table("cpf_categories")
        .select("id,name_zh_tw,name_en,name_vi")
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    taxonomy_prompt = (
        "Create 8 to 18 mutually useful, non-overlapping formal product categories "
        "for the reviewed products below. Reuse a listed existing category only if "
        "it is already a good formal category; otherwise make it an alias of a better "
        "Traditional-Chinese canonical name.\n\nExisting categories:\n"
        + json.dumps(existing_categories, ensure_ascii=False)
        + "\n\nReviewed products:\n"
        + json.dumps(ai_products, ensure_ascii=False)
    )
    taxonomy = call_proxy(proxy, key, args.model, TaxonomyResult, taxonomy_prompt)
    if not 3 <= len(taxonomy.categories) <= 24:
        raise RuntimeError("AI taxonomy size outside safety bounds")
    print(f"reviewed_products={len(products)} proposed_categories={len(taxonomy.categories)}")
    if not args.execute:
        for item in taxonomy.categories:
            print(f"CATEGORY {item.name_zh_tw}: {item.description}")
        return 0

    category_rows = existing_categories[:]
    category_aliases = client.table("cpf_category_aliases").select("category_id,alias").execute().data or []
    aliases_by_category: dict[str, set[str]] = defaultdict(set)
    for row in category_aliases:
        aliases_by_category[row["category_id"]].add(normalized(row["alias"]))

    category_by_name: dict[str, dict] = {}
    for row in category_rows:
        category_by_name[normalized(row["name_zh_tw"])] = row
    canonical_categories: dict[str, dict] = {}
    for item in taxonomy.categories:
        candidate_names = {normalized(item.name_zh_tw), *(normalized(alias) for alias in item.aliases)}
        matched = next(
            (
                row
                for row in category_rows
                if normalized(row["name_zh_tw"]) in candidate_names
                or aliases_by_category[row["id"]].intersection(candidate_names)
            ),
            None,
        )
        if matched:
            old_name = matched["name_zh_tw"]
            client.table("cpf_categories").update(
                {
                    "name_zh_tw": item.name_zh_tw,
                    "name_en": item.name_en,
                    "name_vi": item.name_vi,
                }
            ).eq("id", matched["id"]).execute()
            row = {**matched, "name_zh_tw": item.name_zh_tw}
            aliases = [*item.aliases, old_name]
        else:
            row = (
                client.table("cpf_categories")
                .insert(
                    {
                        "name_zh_tw": item.name_zh_tw,
                        "name_en": item.name_en,
                        "name_vi": item.name_vi,
                        "slug": f"ai-{uuid.uuid4()}",
                        "approved_at": None,
                    }
                )
                .execute()
                .data[0]
            )
            category_rows.append(row)
            aliases = item.aliases
        canonical_categories[normalized(item.name_zh_tw)] = row
        for alias in {value.strip() for value in aliases if value.strip() and normalized(value) != normalized(item.name_zh_tw)}:
            try:
                client.table("cpf_category_aliases").insert(
                    {"category_id": row["id"], "alias": alias}
                ).execute()
            except Exception:
                pass

    category_list = [
        {
            "name_zh_tw": item.name_zh_tw,
            "description": item.description,
            "aliases": item.aliases,
        }
        for item in taxonomy.categories
    ]
    mappings: list[ProductMapping] = []
    for batch in chunks(ai_products, max(1, min(args.batch_size, 40))):
        prompt = (
            "Map every product in this batch to exactly one category from the "
            "provided list. Return a supplier only when one of the supplied "
            "extracted_supplier_candidates explicitly states explicit_in_document=true.\n\n"
            "Categories:\n"
            + json.dumps(category_list, ensure_ascii=False)
            + "\n\nProducts:\n"
            + json.dumps(batch, ensure_ascii=False)
        )
        result = call_proxy(proxy, key, args.model, MappingResult, prompt)
        batch_ids = {item["id"] for item in batch}
        result_ids = {item.product_id for item in result.mappings}
        if result_ids != batch_ids:
            raise RuntimeError("AI mapping did not return every product exactly once")
        mappings.extend(result.mappings)
        print(f"mapped={len(mappings)}/{len(ai_products)}")

    suppliers = (
        client.table("cpf_suppliers")
        .select("id,legal_name")
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    supplier_aliases = client.table("cpf_supplier_aliases").select("supplier_id,alias").execute().data or []

    def find_supplier(name: str):
        key_name = normalized(name)
        for supplier in suppliers:
            if normalized(supplier["legal_name"]) == key_name:
                return supplier
        for alias in supplier_aliases:
            if normalized(alias["alias"]) == key_name:
                return next((item for item in suppliers if item["id"] == alias["supplier_id"]), None)
        return None

    applied_categories = 0
    pending_categories = 0
    applied_suppliers = 0
    pending_suppliers = 0

    def save_suggestion(payload: dict):
        query = (
            client.table("cpf_master_mapping_suggestions")
            .select("id")
            .eq("product_id", payload["product_id"])
            .eq("mapping_type", payload["mapping_type"])
        )
        if payload["mapping_type"] == "category":
            query = query.eq("category_id", payload["category_id"])
        else:
            query = query.eq("supplier_id", payload["supplier_id"]).eq(
                "supplier_role", payload["supplier_role"]
            )
        existing = query.limit(1).execute().data or []
        if existing:
            client.table("cpf_master_mapping_suggestions").update(payload).eq(
                "id", existing[0]["id"]
            ).execute()
        else:
            client.table("cpf_master_mapping_suggestions").insert(payload).execute()

    for mapping in mappings:
        category = canonical_categories.get(normalized(mapping.category_name_zh_tw))
        if not category:
            raise RuntimeError(f"Unknown AI category: {mapping.category_name_zh_tw}")
        category_status = "applied" if mapping.category_confidence >= 0.88 else "pending"
        suggestion = {
            "product_id": mapping.product_id,
            "mapping_type": "category",
            "category_id": category["id"],
            "confidence": mapping.category_confidence,
            "rationale": mapping.category_rationale,
            "model": args.model,
            "prompt_version": "cpf-master-map-v1",
            "status": category_status,
            "applied_at": (
                datetime.now(timezone.utc).isoformat()
                if category_status == "applied"
                else None
            ),
            "applied_by": "ai-backfill" if category_status == "applied" else None,
        }
        save_suggestion(suggestion)
        if category_status == "applied":
            client.table("cpf_products").update({"category_id": category["id"]}).eq(
                "id", mapping.product_id
            ).execute()
            applied_categories += 1
        else:
            pending_categories += 1

        supplier_mapping = mapping.supplier
        if not supplier_mapping or not supplier_mapping.explicit_in_document:
            continue
        supplier = find_supplier(supplier_mapping.original_name)
        if not supplier:
            supplier = (
                client.table("cpf_suppliers")
                .insert(
                    {
                        "legal_name": supplier_mapping.original_name,
                        "notes": "AI backfill: source document explicitly names this supplier; legal entity still requires human verification.",
                    }
                )
                .execute()
                .data[0]
            )
            suppliers.append(supplier)
        supplier_status = "applied" if supplier_mapping.confidence >= 0.90 else "pending"
        save_suggestion(
            {
                "product_id": mapping.product_id,
                "mapping_type": "supplier",
                "supplier_id": supplier["id"],
                "supplier_role": supplier_mapping.role,
                "confidence": supplier_mapping.confidence,
                "rationale": "文件明確出現廠商名稱；角色依來源內容判定。",
                "evidence_excerpt": supplier_mapping.evidence_excerpt or None,
                "model": args.model,
                "prompt_version": "cpf-master-map-v1",
                "status": supplier_status,
                "applied_by": "ai-backfill" if supplier_status == "applied" else None,
            }
        )
        if supplier_status == "applied":
            client.table("cpf_product_suppliers").upsert(
                {
                    "product_id": mapping.product_id,
                    "supplier_id": supplier["id"],
                    "supplier_role": supplier_mapping.role,
                    "confirmation_status": "ai_high_confidence",
                },
                on_conflict="product_id,supplier_id,supplier_role",
            ).execute()
            applied_suppliers += 1
        else:
            pending_suppliers += 1

    print(
        "completed "
        f"categories_applied={applied_categories} categories_pending={pending_categories} "
        f"suppliers_applied={applied_suppliers} suppliers_pending={pending_suppliers}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
