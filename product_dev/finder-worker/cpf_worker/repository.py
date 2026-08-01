from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from supabase import Client, create_client

from .models import DocumentExtraction, ExtractedDocument
from .settings import Settings


class Repository:
    def __init__(self, settings: Settings):
        self.client: Client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )

    def claim_jobs(self, worker_id: str, limit: int) -> list[dict[str, Any]]:
        result = self.client.rpc(
            "cpf_claim_processing_jobs",
            {"p_worker_id": worker_id, "p_limit": limit, "p_lease_minutes": 20},
        ).execute()
        return result.data or []

    def update_job(
        self,
        job_id: str,
        worker_id: str,
        status: str,
        progress: int,
        message: str,
        error_code: str | None = None,
        error_detail: str | None = None,
    ) -> None:
        self.client.rpc(
            "cpf_update_job",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_status": status,
                "p_progress": progress,
                "p_message": message,
                "p_error_code": error_code,
                "p_error_detail": error_detail,
            },
        ).execute()

    def get_version(self, version_id: str) -> dict[str, Any]:
        result = (
            self.client.table("cpf_document_versions")
            .select(
                "*,cpf_documents!cpf_document_versions_document_id_fkey!inner(*)"
            )
            .eq("id", version_id)
            .single()
            .execute()
        )
        return result.data

    def download_source(self, storage_path: str, destination: Path) -> str:
        payload = self.client.storage.from_("cpf_source").download(storage_path)
        destination.write_bytes(payload)
        return hashlib.sha256(payload).hexdigest()

    def upload_artifact(
        self, bucket: str, storage_path: str, local_path: str, content_type: str
    ) -> None:
        with Path(local_path).open("rb") as handle:
            self.client.storage.from_(bucket).upload(
                storage_path,
                handle,
                {"content-type": content_type, "upsert": "true"},
            )

    def upload_product_thumbnails(
        self,
        version_id: str,
        extraction: DocumentExtraction,
        extracted: ExtractedDocument,
        work_dir: Path,
    ) -> None:
        from PIL import Image

        for index, product in enumerate(extraction.products):
            product.representative_thumbnail_path = None
            choice = product.representative_image
            if not choice or choice.confidence < 0.75:
                continue
            page_index = choice.page_number - 1
            if page_index < 0 or page_index >= len(extracted.image_paths):
                continue
            x, y, width, height = choice.bbox_normalized
            if min(x, y, width, height) < 0 or x + width > 1 or y + height > 1:
                continue
            image = Image.open(extracted.image_paths[page_index]).convert("RGB")
            left = max(0, int(x * image.width))
            top = max(0, int(y * image.height))
            right = min(image.width, int((x + width) * image.width))
            bottom = min(image.height, int((y + height) * image.height))
            if right - left < 80 or bottom - top < 80:
                continue
            crop = image.crop((left, top, right, bottom))
            crop.thumbnail((1600, 1600))
            local_path = work_dir / f"representative-{index}.jpg"
            crop.save(local_path, "JPEG", quality=90)
            storage_path = f"{version_id}/representative-{index}.jpg"
            self.upload_artifact(
                "cpf_thumbnail", storage_path, str(local_path), "image/jpeg"
            )
            product.representative_thumbnail_path = storage_path

    def update_artifacts(
        self,
        version_id: str,
        extracted: ExtractedDocument,
        sha256: str,
    ) -> tuple[str | None, str | None]:
        preview_path = None
        thumbnail_path = None
        if extracted.preview_pdf:
            preview_path = f"{version_id}/preview.pdf"
            self.upload_artifact(
                "cpf_preview", preview_path, extracted.preview_pdf, "application/pdf"
            )
        if extracted.thumbnail:
            thumbnail_path = f"{version_id}/thumbnail.jpg"
            self.upload_artifact(
                "cpf_thumbnail", thumbnail_path, extracted.thumbnail, "image/jpeg"
            )
        self.client.table("cpf_document_versions").update(
            {
                "sha256": sha256,
                "page_count": extracted.page_count,
                "deep_analysis_eligible": extracted.deep_analysis_eligible,
                "extracted_text": extracted.text,
                "preview_path": preview_path,
                "thumbnail_path": thumbnail_path,
            }
        ).eq("id", version_id).execute()
        return preview_path, thumbnail_path

    def apply_extraction(
        self,
        version_id: str,
        extraction: DocumentExtraction,
        embedding: list[float] | None,
        model: str | None,
        prompt_version: str,
        usage: dict[str, Any],
    ) -> dict[str, Any]:
        result = self.client.rpc(
            "cpf_apply_ai_extraction_v2",
            {
                "p_document_version_id": version_id,
                "p_result": extraction.model_dump(mode="json"),
                "p_embedding": embedding,
                "p_model": model,
                "p_prompt_version": prompt_version,
                "p_usage": usage,
            },
        ).execute()
        return result.data

    def apply_metadata_only(
        self,
        version_id: str,
        extracted: ExtractedDocument,
        prompt_version: str,
    ) -> dict[str, Any]:
        extraction = DocumentExtraction(
            document_type="other",
            summary_zh_tw=f"僅建立檔案索引：{extracted.reason_skipped}",
            confidence=1,
            review_reasons=[],
            products=[],
        )
        return self.apply_extraction(
            version_id, extraction, None, None, prompt_version, {}
        )

    def finalize_optional_review(self, version_id: str) -> dict[str, Any]:
        result = self.client.rpc(
            "cpf_finalize_optional_review",
            {"p_document_version_id": version_id, "p_actor": "cpf-worker"},
        ).execute()
        return result.data or {}
