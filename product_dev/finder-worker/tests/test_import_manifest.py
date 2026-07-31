from pathlib import Path

import pytest

from import_directory import load_manifest


def test_load_manifest_preserves_csv_order(tmp_path: Path):
    root = tmp_path / "products"
    root.mkdir()
    (root / "first.pdf").write_bytes(b"first")
    (root / "second.jpg").write_bytes(b"second")
    manifest = tmp_path / "candidates.csv"
    manifest.write_text(
        "relative_path,extension\nsecond.jpg,jpg\nfirst.pdf,pdf\n",
        encoding="utf-8",
    )

    assert load_manifest(root, manifest) == [
        (root / "second.jpg").resolve(),
        (root / "first.pdf").resolve(),
    ]


def test_load_manifest_rejects_escape(tmp_path: Path):
    root = tmp_path / "products"
    root.mkdir()
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"outside")
    manifest = tmp_path / "candidates.csv"
    manifest.write_text(
        "relative_path,extension\n../outside.pdf,pdf\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="escapes root"):
        load_manifest(root, manifest)
