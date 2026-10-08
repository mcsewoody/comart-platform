-- 報價系統產品：KP（Key Product）與 RP（Retail Packaging）兩個勾選欄位（quotation v3.70）
-- 產品清單與報價單的選產品區都可依此過濾。
-- 🔴 web_products_public 是建立時就展開欄位的 view，新增欄位不會跑到官網的公開 API 上。
-- 還原：alter table public.products drop column kp, drop column rp;
alter table public.products add column if not exists kp boolean not null default false;
alter table public.products add column if not exists rp boolean not null default false;
