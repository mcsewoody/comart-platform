from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

from openai import OpenAI
from supabase import create_client


def values(text: str) -> set[str]:
    return {item.strip().casefold() for item in text.split("|") if item.strip()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    client = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )
    openai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    rows = [
        row
        for row in csv.DictReader(args.manifest.open(encoding="utf-8-sig"))
        if row["woody_confirmed"].lower() == "true"
    ]
    if not rows:
        raise RuntimeError("No Woody-confirmed golden rows")

    model_hits = category_hits = supplier_hits = top5_hits = 0
    model_total = category_total = supplier_total = top5_total = 0
    for row in rows:
        source = (
            client.table("cpf_document_sources")
            .select("document_id")
            .eq("relative_path", row["relative_path"])
            .single()
            .execute()
            .data
        )
        document = (
            client.table("cpf_documents")
            .select("current_version_id")
            .eq("id", source["document_id"])
            .single()
            .execute()
            .data
        )
        version = (
            client.table("cpf_document_versions")
            .select("analysis_result")
            .eq("id", document["current_version_id"])
            .single()
            .execute()
            .data
        )
        product_ids = version["analysis_result"].get("productIds", [])
        products = (
            client.table("cpf_products")
            .select("id,model_numbers,cpf_categories(name_zh_tw),cpf_product_suppliers(cpf_suppliers(legal_name))")
            .in_("id", product_ids)
            .execute()
            .data
            if product_ids
            else []
        )
        actual_models = {
            model.casefold()
            for product in products
            for model in product.get("model_numbers", [])
        }
        expected_models = values(row["expected_models"])
        if expected_models:
            model_total += 1
            model_hits += expected_models == actual_models

        if row["expected_category"].strip():
            category_total += 1
            actual_categories = {
                (product.get("cpf_categories") or {}).get("name_zh_tw", "").casefold()
                for product in products
            }
            category_hits += row["expected_category"].strip().casefold() in actual_categories

        expected_suppliers = values(row["expected_supplier"])
        if expected_suppliers:
            supplier_total += 1
            actual_suppliers = {
                relation["cpf_suppliers"]["legal_name"].casefold()
                for product in products
                for relation in product.get("cpf_product_suppliers", [])
                if relation.get("cpf_suppliers")
            }
            supplier_hits += expected_suppliers == actual_suppliers

        query = row["representative_query"].strip()
        if query and expected_models:
            top5_total += 1
            embedding = openai.embeddings.create(
                model="text-embedding-3-large", input=query
            ).data[0].embedding
            results = client.rpc(
                "cpf_search_products",
                {
                    "p_query": query,
                    "p_filters": {},
                    "p_page": 1,
                    "p_page_size": 5,
                    "p_embedding": embedding,
                },
            ).execute().data
            returned_models = {
                model.casefold()
                for product in results
                for model in product.get("model_numbers", [])
            }
            top5_hits += bool(expected_models & returned_models)

    def rate(hits: int, total: int) -> float:
        return hits / total if total else 0

    model_rate = rate(model_hits, model_total)
    category_rate = rate(category_hits, category_total)
    supplier_rate = rate(supplier_hits, supplier_total)
    top5_rate = rate(top5_hits, top5_total)
    print(f"model_accuracy={model_rate:.3f} ({model_hits}/{model_total})")
    print(f"category_accuracy={category_rate:.3f} ({category_hits}/{category_total})")
    print(f"supplier_accuracy={supplier_rate:.3f} ({supplier_hits}/{supplier_total})")
    print(f"top5_hit_rate={top5_rate:.3f} ({top5_hits}/{top5_total})")
    passed = (
        model_rate >= 0.9
        and category_rate >= 0.9
        and supplier_rate >= 0.85
        and top5_rate >= 0.9
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
