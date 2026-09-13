from __future__ import annotations

import argparse
import base64
import hashlib
import mimetypes
import os
import socket
import tempfile
import traceback
from datetime import date, datetime, timezone
from pathlib import Path

import httpx
from supabase import create_client

from cpf_worker.extractors import extract_document


KINDS = {
    "mfg": ["design_drawing", "bom", "cad", "image", "presentation", "document", "other"],
    "buy": ["catalog", "quotation", "image", "presentation", "document", "cad", "other"],
}


def required(name: str) -> str:
    value = os.getenv(name, "")
    if not value:
        raise RuntimeError(f"Missing required environment: {name}")
    return value


def image_content(path: str) -> dict[str, str]:
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
    return {"type": "input_image", "image_url": f"data:{mime};base64,{encoded}", "detail": "low"}


def analyze(proxy_url: str, key: str, dataset: str, row: dict, extracted) -> tuple[dict, dict]:
    system = (
        "你是 COMART 內部文件索引員。只分析整份文件，不建立產品主檔，不拆分圖片。"
        "根據檔名、目錄、可讀文字與頁面影像，輸出 5 到 15 個具搜尋價值的繁中或原文關鍵字、"
        "一段 80 字內繁中摘要與文件類型。型號、品牌、廠商原名不得翻譯或猜測。"
        "目錄是自製或外購分類的權威，不得更改來源工廠或廠商。"
        "另從文件內容選出一個主要文件日期與版本／版次，並逐項提供短證據及頁碼或工作表位置。"
        "報價單日期優先順序：報價日期、發行日期、修訂日期、製作日期；"
        "BOM 優先順序：發行日期、修訂日期、製作日期；其他文件優先選發行日期、修訂日期、製作日期。"
        "內容沒有明確日期時才可使用檔名中的日期，並標記 filename_date；不得使用檔案修改日或上傳日。"
        "日期必須輸出 YYYY-MM-DD；沒有可靠證據時，日期、類型、版本與相應證據全部輸出 null。"
    )
    content: list[dict[str, str]] = [{
        "type": "input_text",
        "text": (
            f"資料庫：{dataset}\n相對路徑：{row['relative_path']}\n"
            f"目前文件類型：{row['document_kind']}\n擷取文字：\n{extracted.text[:100000]}"
        ),
    }]
    content.extend(image_content(path) for path in extracted.image_paths[:4])
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "keywords": {"type": "array", "items": {"type": "string"}, "minItems": 5, "maxItems": 15},
            "summary_zh_tw": {"type": "string"},
            "document_kind": {"type": "string", "enum": KINDS[dataset]},
            "primary_document_date": {"type": ["string", "null"]},
            "primary_date_type": {
                "type": ["string", "null"],
                "enum": ["quotation_date", "issue_date", "revision_date", "creation_date", "filename_date", None],
            },
            "primary_date_evidence": {"type": ["string", "null"]},
            "primary_date_location": {"type": ["string", "null"]},
            "revision_label": {"type": ["string", "null"]},
            "revision_evidence": {"type": ["string", "null"]},
            "revision_location": {"type": ["string", "null"]},
        },
        "required": [
            "keywords", "summary_zh_tw", "document_kind", "primary_document_date",
            "primary_date_type", "primary_date_evidence", "primary_date_location",
            "revision_label", "revision_evidence", "revision_location",
        ],
    }
    response = httpx.post(
        proxy_url,
        headers={"apikey": key, "Content-Type": "application/json"},
        json={
            "action": "analyze",
            "model": os.getenv("PD_ROUTINE_MODEL", "gpt-5.6-luna"),
            "systemPrompt": system,
            "content": content,
            "schema": schema,
        },
        timeout=360,
    )
    if response.is_error:
        raise RuntimeError(f"AI proxy failed ({response.status_code}): {response.text[:1000]}")
    result = response.json()
    return result["extraction"], result.get("usage") or {}


def normalize_document_date(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip()).isoformat()
    except ValueError:
        return None


def clean_optional_text(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split()).strip()
    return cleaned[:limit] or None


def upload_artifact(client, bucket: str, object_path: str, local_path: str, content_type: str) -> None:
    with Path(local_path).open("rb") as handle:
        client.storage.from_(bucket).upload(
            object_path, handle, {"content-type": content_type, "upsert": "true"}
        )


def process(client, dataset: str, job: dict, worker_id: str, proxy_url: str, key: str) -> None:
    table = f"pd_{dataset}_documents"
    prefix = f"pd_{dataset}"
    row = client.table(table).select("*").eq("id", job["document_id"]).single().execute().data
    client.table(table).update({"analysis_status": "processing"}).eq("id", row["id"]).execute()
    try:
        suffix = f".{row['extension']}"
        with tempfile.TemporaryDirectory(prefix="pd-document-worker-") as directory:
            work_dir = Path(directory)
            source = work_dir / f"source{suffix}"
            payload = client.storage.from_(f"{prefix}_source").download(row["storage_path"])
            source.write_bytes(payload)
            if hashlib.sha256(payload).hexdigest() != row["sha256"]:
                raise RuntimeError("source SHA-256 mismatch")
            extracted = extract_document(source, work_dir, 100 * 1024 * 1024, 100)
            preview_path = None
            thumbnail_path = None
            if extracted.preview_pdf:
                preview_path = f"{row['id']}/preview.pdf"
                upload_artifact(client, f"{prefix}_preview", preview_path, extracted.preview_pdf, "application/pdf")
            if extracted.thumbnail:
                thumbnail_path = f"{row['id']}/thumbnail.jpg"
                upload_artifact(client, f"{prefix}_thumbnail", thumbnail_path, extracted.thumbnail, "image/jpeg")

            result, usage = analyze(proxy_url, key, dataset, row, extracted)
            primary_date = normalize_document_date(result.get("primary_document_date"))
            primary_date_type = result.get("primary_date_type") if primary_date else None
            if primary_date_type not in {
                "quotation_date", "issue_date", "revision_date", "creation_date", "filename_date"
            }:
                primary_date_type = None
                primary_date = None
            path_context = " ".join([
                row["title"], row["relative_path"], row.get("source_factory") or "",
                row.get("supplier_name") or "", " ".join(row.get("category_path") or []),
                " ".join(row.get("product_path") or []), " ".join(result["keywords"]),
                result["summary_zh_tw"], primary_date or "", result.get("revision_label") or "",
                extracted.text.replace("\x00", "")[:300000],
            ])
            client.table(table).update({
                "preview_path": preview_path,
                "thumbnail_path": thumbnail_path,
                "keywords": result["keywords"],
                "summary_zh_tw": result["summary_zh_tw"],
                "document_kind": result["document_kind"],
                "primary_document_date": primary_date,
                "primary_date_type": primary_date_type,
                "primary_date_evidence": clean_optional_text(result.get("primary_date_evidence"), 500) if primary_date else None,
                "primary_date_location": clean_optional_text(result.get("primary_date_location"), 200) if primary_date else None,
                "revision_label": clean_optional_text(result.get("revision_label"), 100),
                "revision_evidence": clean_optional_text(result.get("revision_evidence"), 500),
                "revision_location": clean_optional_text(result.get("revision_location"), 200),
                "extracted_text": extracted.text.replace("\x00", "")[:300000],
                "search_text": path_context,
                "analysis_status": "completed",
                "analysis_model": os.getenv("PD_ROUTINE_MODEL", "gpt-5.6-luna"),
                "ai_usage": usage,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", row["id"]).execute()
        client.rpc("pd_finish_job", {
            "p_dataset": dataset, "p_job_id": job["id"], "p_worker_id": worker_id,
            "p_status": "completed", "p_error_detail": None,
        }).execute()
    except Exception:
        detail = traceback.format_exc()[-8000:]
        client.table(table).update({"analysis_status": "failed"}).eq("id", row["id"]).execute()
        client.rpc("pd_finish_job", {
            "p_dataset": dataset, "p_job_id": job["id"], "p_worker_id": worker_id,
            "p_status": "failed", "p_error_detail": detail,
        }).execute()
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", choices=("mfg", "buy", "both"), default="both")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()
    url = required("SUPABASE_URL")
    key = required("SUPABASE_SERVICE_ROLE_KEY")
    proxy_url = os.getenv("PD_AI_PROXY_URL") or f"{url}/functions/v1/pd-ai-worker"
    client = create_client(url, key)
    worker_id = f"pd-github-{socket.gethostname()}-{os.getpid()}"
    failures = 0
    claimed = 0
    for dataset in (["mfg", "buy"] if args.dataset == "both" else [args.dataset]):
        jobs = client.rpc("pd_claim_jobs", {
            "p_dataset": dataset, "p_worker_id": worker_id,
            "p_limit": args.limit, "p_lease_minutes": 30,
        }).execute().data or []
        claimed += len(jobs)
        for job in jobs:
            try:
                process(client, dataset, job, worker_id, proxy_url, key)
            except Exception as error:
                failures += 1
                print(f"{dataset} job {job['id']} failed: {error}")
    print(f"claimed={claimed} failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
