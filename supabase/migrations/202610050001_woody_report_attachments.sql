-- ═══════════════════════════════════════════════════════════════════════
-- Woody 週報：附件（board v1.93）
--
-- woody_reports.attachments：jsonb 陣列，每一筆
--   { path, name, mime, size, w?, h? }
--   path ＝ storage 物件鍵（純 ASCII，wr/<資料夾>/<uid>.<ext>），name ＝ 原始檔名（只用於顯示）。
--
-- 🔴 bucket 是 **private**（同 chat-images）：週報附件多半是內部文章截圖、簡報、PDF，
--    公開 bucket 的網址一旦轉發出去就永久有效、不需登入。顯示一律向 sb-proxy 換簽章網址。
-- 🔴 刻意**不**加入 sb-proxy 的 RESTRICTED_BUCKETS：週報是給全公司看的，
--    任何持有有效 session 的人都要讀得到。
-- 🔴 存 jsonb 而不是子表：週報清單一次撈 300 筆，join 子表等於每次載入多一個查詢，
--    而附件永遠跟著那一份週報一起讀、一起寫。
-- ═══════════════════════════════════════════════════════════════════════

alter table public.woody_reports
  add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit)
values ('woody-attachments', 'woody-attachments', false, 26214400)   -- 25 MB／檔
on conflict (id) do nothing;
