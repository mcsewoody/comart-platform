from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from supabase import create_client

TABLES = [
    "cpf_profiles",
    "cpf_categories",
    "cpf_suppliers",
    "cpf_supplier_aliases",
    "cpf_products",
    "cpf_documents",
    "cpf_document_sources",
    "cpf_document_versions",
    "cpf_product_documents",
    "cpf_product_suppliers",
    "cpf_specifications",
    "cpf_quotes",
    "cpf_quote_tiers",
    "cpf_evidence",
    "cpf_tags",
    "cpf_product_tags",
    "cpf_review_tasks",
    "cpf_duplicate_suggestions",
    "cpf_document_access_grants",
    "cpf_product_revisions",
]
BUCKETS = ["cpf_source", "cpf_preview", "cpf_thumbnail"]


def export_table(client, table: str, output: Path) -> None:
    rows = []
    start = 0
    while True:
        batch = client.table(table).select("*").range(start, start + 999).execute().data
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    output.write_text(
        json.dumps(rows, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def list_objects(client, bucket: str, prefix: str = "") -> list[str]:
    found: list[str] = []
    offset = 0
    while True:
        entries = client.storage.from_(bucket).list(
            prefix,
            {"limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
        )
        if not entries:
            break
        for entry in entries:
            name = entry["name"]
            path = f"{prefix}/{name}".strip("/")
            if entry.get("id"):
                found.append(path)
            else:
                found.extend(list_objects(client, bucket, path))
        if len(entries) < 1000:
            break
        offset += 1000
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    client = create_client(url, key)
    root = args.output / datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    metadata_dir = root / "metadata"
    storage_dir = root / "storage"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    storage_dir.mkdir(parents=True, exist_ok=True)

    for table in TABLES:
        export_table(client, table, metadata_dir / f"{table}.json")
    for bucket in BUCKETS:
        for object_path in list_objects(client, bucket):
            destination = storage_dir / bucket / object_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(
                client.storage.from_(bucket).download(object_path)
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
