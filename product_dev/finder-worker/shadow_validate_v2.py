from __future__ import annotations

import argparse
import csv
import json
import tempfile
from collections import Counter
from pathlib import Path

from cpf_worker.ai import ProductAnalyzer
from cpf_worker.extractors import extract_document
from cpf_worker.settings import Settings


def manifest_paths(root: Path, manifest: Path) -> list[tuple[Path, str]]:
    rows: list[tuple[Path, str]] = []
    with manifest.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            relative = (row.get("relative_path") or "").strip()
            if not relative:
                continue
            source = (root / relative).resolve()
            if not source.is_relative_to(root):
                raise ValueError(f"manifest path escapes root: {relative}")
            if not source.is_file():
                raise FileNotFoundError(relative)
            rows.append((source, (row.get("expected_policy") or "").strip()))
    return rows


def main() -> int:
    product_dev_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Run CPF extraction policy v2 without writing to Supabase."
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=product_dev_root / "golden-set" / "v2-representative.csv",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    manifest = args.manifest.expanduser().resolve()
    settings = Settings.from_env()
    analyzer = ProductAnalyzer(settings)
    results: list[dict] = []

    for source, expected_policy in manifest_paths(root, manifest):
        relative = source.relative_to(root).as_posix()
        with tempfile.TemporaryDirectory(prefix="cpf-shadow-v2-") as directory:
            work_dir = Path(directory)
            extracted = extract_document(
                source,
                work_dir,
                settings.max_deep_bytes,
                settings.max_deep_pages,
            )
            extraction, model, usage = analyzer.analyze(extracted, relative)
            kind_counts = Counter(item.record_kind for item in extraction.products)
            item_rows = [
                {
                    "name": item.name_zh_tw or item.name_original,
                    "kind": item.record_kind,
                    "familyKey": item.family_key,
                    "signals": item.identity_signals,
                    "rationale": item.creation_rationale,
                    "confidence": item.confidence,
                }
                for item in extraction.products
            ]
            row = {
                "relativePath": relative,
                "expectedPolicy": expected_policy,
                "documentType": extraction.document_type,
                "model": model,
                "masterProductCount": len(extraction.master_products),
                "kindCounts": dict(kind_counts),
                "items": item_rows,
                "reviewReasons": extraction.review_reasons,
                "usage": usage,
            }
            results.append(row)
            print(
                f"{relative}: masters={row['masterProductCount']} "
                f"kinds={row['kindCounts']}"
            )

    report = {
        "policyVersion": settings.prompt_version,
        "documents": results,
        "totals": {
            "documents": len(results),
            "masterProducts": sum(item["masterProductCount"] for item in results),
            "itemKinds": dict(
                sum(
                    (Counter(item["kindCounts"]) for item in results),
                    Counter(),
                )
            ),
        },
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(json.dumps(report["totals"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
