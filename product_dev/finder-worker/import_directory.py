from __future__ import annotations

import argparse
import csv
import hashlib
import mimetypes
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SUPPORTED_EXTENSIONS = {
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
METADATA_EXTENSIONS = {
    ".dwg",
    ".dxf",
    ".step",
    ".stp",
    ".iges",
    ".igs",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
}
ALL_EXTENSIONS = SUPPORTED_EXTENSIONS | METADATA_EXTENSIONS
MAX_STORAGE_BYTES = 500 * 1024 * 1024
RESUMABLE_THRESHOLD = 6 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def discover(root: Path, project_dir: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if (
            path.is_file()
            and path.suffix.lower() in ALL_EXTENSIONS
            and project_dir not in path.parents
            and not any(part.startswith(".") for part in path.relative_to(root).parts)
        ):
            files.append(path)
    return sorted(files)


def load_manifest(root: Path, manifest: Path) -> list[Path]:
    files: list[Path] = []
    with manifest.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            relative_path = (row.get("relative_path") or "").strip()
            if not relative_path:
                continue
            path = (root / relative_path).resolve()
            if not path.is_relative_to(root):
                raise ValueError(f"manifest path escapes root: {relative_path}")
            if not path.is_file():
                raise FileNotFoundError(f"manifest file missing: {relative_path}")
            if path.suffix.lower() not in ALL_EXTENSIONS:
                raise ValueError(f"unsupported manifest file: {relative_path}")
            files.append(path)
    return files


def upload_resumable(
    supabase_url: str,
    service_key: str,
    source: Path,
    storage_path: str,
    mime_type: str,
) -> None:
    from tusclient import client as tus_client

    uploader = tus_client.TusClient(
        f"{supabase_url}/storage/v1/upload/resumable",
        headers={
            "apikey": service_key,
            "x-upsert": "false",
        },
    ).uploader(
        file_path=str(source),
        chunk_size=6 * 1024 * 1024,
        metadata={
            "bucketName": "cpf_source",
            "objectName": storage_path,
            "contentType": mime_type,
            "cacheControl": "3600",
        },
    )
    uploader.upload()


def main() -> int:
    default_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        description="Scan the Products directory. Dry-run unless --execute is supplied."
    )
    parser.add_argument("--root", type=Path, default=default_root)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument(
        "--sensitivity",
        choices=["general", "commercial", "highly_confidential"],
        default="general",
    )
    parser.add_argument("--mark-missing", action="store_true")
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    project_dir = Path(__file__).resolve().parents[1]
    scan_started = datetime.now(timezone.utc)
    files = (
        load_manifest(root, args.manifest.expanduser().resolve())
        if args.manifest
        else discover(root, project_dir)
    )
    files = files[args.offset :]
    if args.limit:
        files = files[: args.limit]
    total_bytes = sum(path.stat().st_size for path in files)
    print(f"root={root}")
    print(f"files={len(files)} bytes={total_bytes} execute={args.execute}")
    if not args.execute:
        for path in files[:20]:
            print(path.relative_to(root))
        if len(files) > 20:
            print(f"... and {len(files) - 20} more")
        return 0

    supabase_url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
            file=sys.stderr,
        )
        return 2
    from supabase import create_client
    from tqdm import tqdm

    client = create_client(supabase_url, service_key)
    failures = 0

    for path in tqdm(files, unit="file"):
        try:
            size = path.stat().st_size
            if size > MAX_STORAGE_BYTES:
                raise ValueError("file exceeds 500 MB bucket limit")
            digest = sha256_file(path)
            relative_path = path.relative_to(root).as_posix()
            existing = (
                client.table("cpf_document_versions")
                .select("id,document_id")
                .eq("sha256", digest)
                .limit(1)
                .execute()
            )
            mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            storage_path = f"{digest[:2]}/{digest}/source{path.suffix.lower()}"

            if not existing.data:
                if size > RESUMABLE_THRESHOLD:
                    upload_resumable(
                        supabase_url, service_key, path, storage_path, mime_type
                    )
                else:
                    with path.open("rb") as handle:
                        client.storage.from_("cpf_source").upload(
                            storage_path,
                            handle,
                            {"content-type": mime_type, "upsert": "false"},
                        )

            client.rpc(
                "cpf_register_import",
                {
                    "p_title": path.name,
                    "p_relative_path": relative_path,
                    "p_storage_path": storage_path,
                    "p_mime_type": mime_type,
                    "p_extension": path.suffix.lower().lstrip("."),
                    "p_byte_size": size,
                    "p_sha256": digest,
                    "p_sensitivity": args.sensitivity,
                },
            ).execute()
        except Exception as error:
            failures += 1
            tqdm.write(f"FAILED {path}: {error}")

    if args.mark_missing:
        client.rpc(
            "cpf_mark_missing_sources",
            {"p_seen_before": scan_started.isoformat()},
        ).execute()
    print(f"completed={len(files) - failures} failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
