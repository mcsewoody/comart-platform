from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path

FORMATS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=50)
    args = parser.parse_args()
    root = args.root.resolve()
    project = Path(__file__).resolve().parents[1]
    by_extension: dict[str, list[Path]] = defaultdict(list)
    for path in sorted(root.rglob("*")):
        if (
            path.is_file()
            and path.suffix.lower() in FORMATS
            and project not in path.parents
        ):
            by_extension[path.suffix.lower()].append(path)

    selected: list[Path] = []
    formats = sorted(by_extension)
    while len(selected) < args.count and any(by_extension.values()):
        for extension in formats:
            if by_extension[extension] and len(selected) < args.count:
                selected.append(by_extension[extension].pop(0))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "relative_path",
                "extension",
                "scenario",
                "expected_document_type",
                "expected_product_count",
                "expected_models",
                "expected_category",
                "expected_supplier",
                "representative_query",
                "representative_image_ok",
                "woody_confirmed",
                "notes",
            ],
        )
        writer.writeheader()
        for path in selected:
            writer.writerow(
                {
                    "relative_path": path.relative_to(root).as_posix(),
                    "extension": path.suffix.lower().lstrip("."),
                    "scenario": "",
                    "expected_document_type": "",
                    "expected_product_count": "",
                    "expected_models": "",
                    "expected_category": "",
                    "expected_supplier": "",
                    "representative_query": "",
                    "representative_image_ok": "",
                    "woody_confirmed": "false",
                    "notes": "",
                }
            )
    print(f"wrote {len(selected)} candidates to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
