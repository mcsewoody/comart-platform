from __future__ import annotations

import tempfile
import traceback
from pathlib import Path

from .ai import ProductAnalyzer
from .extractors import extract_document
from .repository import Repository
from .settings import Settings


class JobProcessor:
    def __init__(self, settings: Settings, repository: Repository):
        self.settings = settings
        self.repository = repository
        self.analyzer = ProductAnalyzer(settings)

    def process(self, job: dict, worker_id: str) -> None:
        job_id = job["id"]
        version_id = job["document_version_id"]
        try:
            version = self.repository.get_version(version_id)
            document_row = version.get("cpf_documents", {})
            source_name = document_row.get("title") or Path(version["storage_path"]).name
            source_context = " | ".join(
                value
                for value in [source_name, document_row.get("source_path")]
                if value
            )
            suffix = Path(version["storage_path"]).suffix
            with tempfile.TemporaryDirectory(prefix="cpf-worker-") as directory:
                work_dir = Path(directory)
                source = work_dir / f"source{suffix}"
                sha256 = self.repository.download_source(
                    version["storage_path"], source
                )
                self.repository.update_job(
                    job_id, worker_id, "converting", 20, "解析與轉檔"
                )
                extracted = extract_document(
                    source,
                    work_dir,
                    self.settings.max_deep_bytes,
                    self.settings.max_deep_pages,
                )
                self.repository.update_artifacts(version_id, extracted, sha256)

                if not extracted.deep_analysis_eligible:
                    self.repository.apply_metadata_only(
                        version_id, extracted, self.settings.prompt_version
                    )
                    self.repository.update_job(
                        job_id, worker_id, "completed", 100, "已建立 metadata 索引"
                    )
                    return

                self.repository.update_job(
                    job_id, worker_id, "analyzing", 55, "AI 分析與結構化抽取"
                )
                extraction, model, usage = self.analyzer.analyze(
                    extracted, source_context
                )
                self.repository.upload_product_thumbnails(
                    version_id, extraction, extracted, work_dir
                )
                embedding = self.analyzer.embed(extraction, extracted.text)
                self.repository.apply_extraction(
                    version_id,
                    extraction,
                    embedding,
                    model,
                    self.settings.prompt_version,
                    usage,
                )
                final_status = "needs_review" if extraction.needs_review else "completed"
                message = "等待人工審核" if extraction.needs_review else "分析完成"
                self.repository.update_job(
                    job_id, worker_id, final_status, 100, message
                )
        except Exception as error:
            self.repository.update_job(
                job_id,
                worker_id,
                "failed",
                100,
                "處理失敗，將依重試政策再次執行",
                type(error).__name__,
                traceback.format_exc()[-8000:],
            )
            raise
