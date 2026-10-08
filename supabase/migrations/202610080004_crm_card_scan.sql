-- CRM 客戶基本資料 ＋ 名片掃描（quotation v3.71，2026-10-08 Woody）
--
-- 客戶（crm_accounts）：常用交易／聯絡基本資料。報價單刻意不跟著加欄位（Woody：「報價單還是保持簡單」）。
-- 聯絡人（crm_contacts）：名片上的其他資訊 ＋ 名片圖（正面／背面的 storage 路徑，已轉正）。
-- card_data：AI 從名片讀出的完整結果（含沒有對應欄位的資訊），留底供日後查。
--
-- 🔴 名片圖放私有 bucket crm-cards，讀寫由 sb-proxy 限「業務部 ＋ admin」（名片是個資）。
-- 還原：alter table crm_accounts drop column ...; alter table crm_contacts drop column ...;
--       delete from storage.buckets where id='crm-cards';

alter table public.crm_accounts add column if not exists "companyAlt"  text;  -- 另一種語言的公司名
alter table public.crm_accounts add column if not exists address       text;
alter table public.crm_accounts add column if not exists "shipAddress" text;
alter table public.crm_accounts add column if not exists phone         text;
alter table public.crm_accounts add column if not exists fax           text;
alter table public.crm_accounts add column if not exists "taxId"       text;
alter table public.crm_accounts add column if not exists incoterm      text;
alter table public.crm_accounts add column if not exists currency      text;
alter table public.crm_accounts add column if not exists "payTerms"    text;

alter table public.crm_contacts add column if not exists "nameAlt"   text;   -- 另一種語言的姓名
alter table public.crm_contacts add column if not exists dept        text;
alter table public.crm_contacts add column if not exists mobile      text;
alter table public.crm_contacts add column if not exists fax         text;
alter table public.crm_contacts add column if not exists im          text;   -- LINE／WeChat／WhatsApp／Zalo…
alter table public.crm_contacts add column if not exists "cardFront" text;   -- crm-cards 內的物件路徑
alter table public.crm_contacts add column if not exists "cardBack"  text;
alter table public.crm_contacts add column if not exists "cardData"  jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-cards', 'crm-cards', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
