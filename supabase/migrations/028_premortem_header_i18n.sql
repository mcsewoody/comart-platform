-- 028_premortem_header_i18n.sql
-- Premortem 階段2（雙語）：premortem_sessions 增加專案描述與情境的雙語欄位。
-- 建會時以 claude-proxy 翻成該場設定的語言 A/B 並存入；主席畫面雙語並陳。
-- entries 的雙語欄位 text_a/text_b 已於 027 建立。

alter table public.premortem_sessions
  add column if not exists desc_a     text,
  add column if not exists desc_b     text,
  add column if not exists scenario_a text,
  add column if not exists scenario_b text;
