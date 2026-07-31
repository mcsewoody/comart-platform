from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    openai_api_key: str | None = None
    ai_proxy_url: str | None = None
    routine_model: str = "gpt-5.6-luna"
    escalation_model: str = "gpt-5.6-terra"
    embedding_model: str = "text-embedding-3-large"
    prompt_version: str = "cpf-extract-v1"
    max_deep_bytes: int = 100 * 1024 * 1024
    max_deep_pages: int = 100

    @classmethod
    def from_env(cls) -> "Settings":
        required = {
            "SUPABASE_URL": os.getenv("SUPABASE_URL"),
            "SUPABASE_SERVICE_ROLE_KEY": os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise RuntimeError(f"Missing required environment: {', '.join(missing)}")
        return cls(
            supabase_url=required["SUPABASE_URL"] or "",
            supabase_service_role_key=required["SUPABASE_SERVICE_ROLE_KEY"] or "",
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            ai_proxy_url=os.getenv("CPF_AI_PROXY_URL")
            or f"{required['SUPABASE_URL']}/functions/v1/cpf-ai-worker",
            routine_model=os.getenv("CPF_ROUTINE_MODEL", "gpt-5.6-luna"),
            escalation_model=os.getenv("CPF_ESCALATION_MODEL", "gpt-5.6-terra"),
            embedding_model=os.getenv(
                "CPF_EMBEDDING_MODEL", "text-embedding-3-large"
            ),
        )
