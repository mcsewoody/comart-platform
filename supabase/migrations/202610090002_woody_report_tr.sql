-- Woody 週報的翻譯快取（board v1.99，2026-10-09 Woody）
--   介面是 English／Tiếng Việt／简体中文 的人閱讀時看到譯文；編輯一律以繁中為主。
--   「有人閱讀時才翻」：第一位用該語言打開的人觸發翻譯，之後所有人讀快取。
--   hash＝原文六段的指紋；Woody 改過中文，指紋不同，舊譯文自動作廢、下次閱讀重翻。
-- 🔴 只有 edge function wr-translate（service role）讀寫，刻意不進 sb-proxy 白名單：
--    同仁的瀏覽器若能寫譯文，就能偽造「Woody 週報的越南文版」。
-- report_id='__footer__' 是週報固定的「OKR 原則／知識學習平台」清單的譯文。
-- 還原：drop table public.woody_report_tr;
create table if not exists public.woody_report_tr (
  report_id  text not null,
  lang       text not null check (lang in ('en','vi','zh-CN')),
  hash       text not null,
  sections   jsonb not null,
  model      text,
  created_at timestamptz not null default now(),
  primary key (report_id, lang)
);
alter table public.woody_report_tr enable row level security;
revoke all on public.woody_report_tr from anon, authenticated;
