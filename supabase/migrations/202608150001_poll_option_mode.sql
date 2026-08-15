-- 202608150001_poll_option_mode.sql
-- 投票選項呈現方式：主持人可選
--   'each'    = 每個選項各自配圖（預設，現況）
--   'letters' = 一張總圖 + 字母代號（A B C…）
--   'numbers' = 一張總圖 + 數字代號（1 2 3…）
-- 後兩者選項只是代號，總圖沿用 bg_images。
alter table public.poll_sessions
  add column if not exists option_mode text not null default 'each';
