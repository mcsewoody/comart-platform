-- ═══════════════════════════════════════════════════════════════════════
-- AI Woody 的人格檔（Portal v2.12，edge function ai-woody）
--
-- 🔴 人格檔不能放在前端，也不能放在 repo：repo 在 GitHub 上是公開的，
--    寫進 HTML 的話任何人看原始碼都讀得到（經營理念、內部文化、週報裡的虧損與客戶事件）。
--    所以存在這張表，由 ai-woody 用 service role 讀，呼叫模型時才加進 system prompt。
-- 🔴 RLS 開著 ＋ 零 policy ＋ 撤銷 anon／authenticated：只有 service role 讀得到。
--    刻意不加入 sb-proxy 的 ALLOWED_TABLES —— 那會讓任何登入者都能把整份人格檔撈走。
-- 內容由 scripts/ai-woody-push.py 從 .local/woody/ 組好上傳（本機檔案不進版控）。
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.ai_personas (
  id          text primary key,
  system      text not null,
  version     text not null default '',
  updated_at  timestamptz not null default now()
);

alter table public.ai_personas enable row level security;
revoke all on public.ai_personas from anon, authenticated;
