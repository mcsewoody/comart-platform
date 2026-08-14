-- 202608080024_poll_title_i18n.sql
-- 投票雙語：題目也可雙語(desc_a/b、label_a/b 已於 202608080022 建立)。
alter table public.poll_sessions
  add column if not exists title_a text,
  add column if not exists title_b text;
