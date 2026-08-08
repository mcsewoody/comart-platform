-- 029_premortem_ai_summary.sql
-- 事前驗屍：定稿時由 AI 產生一段「會議結論」總結（直接、深刻、嚴厲、不留情面的分析），存檔備查。
-- ai_summary   = 產生時使用的原文（等同語言 A，保留給匯出當 fallback）
-- ai_summary_a = 該場設定的語言 A 版本
-- ai_summary_b = 該場設定的語言 B 版本
-- summary_at   = 產生時間（重新生成會覆蓋）

alter table public.premortem_sessions
  add column if not exists ai_summary   text,
  add column if not exists ai_summary_a text,
  add column if not exists ai_summary_b text,
  add column if not exists summary_at   timestamptz;
