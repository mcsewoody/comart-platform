-- KMS「Woody 推薦閱讀」的 AI Woody 導讀（2026-10-08）
-- wr_intro：{ "zh-TW": "...", "zh-CN": "...", "en": "...", "vi": "...", "ja": "..." }
-- 由 ai-woody 的 action:'intro' 以 service role 寫入（只有 Woody 本人或本機腳本觸發得了），
-- 前端不寫：sb-proxy 對這個分類的文件只放行 view_count／embedding 兩個欄位（見 KMS_HARMLESS_PATCH）。
-- 還原：alter table public.kms_documents drop column wr_intro, drop column wr_intro_at;
alter table public.kms_documents add column if not exists wr_intro jsonb;
alter table public.kms_documents add column if not exists wr_intro_at timestamptz;
