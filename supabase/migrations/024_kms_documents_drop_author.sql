-- 024_kms_documents_drop_author.sql
--
-- 背景：kms_documents 有兩個作者欄位造成混淆──
--   * author       整欄都是 'admin'（大量匯入用的服務帳號），前端從未讀寫，無鑑別力
--   * author_name  真正的作者姓名（22 位真人），前端所有清單/搜尋/編輯/顯示都只用這欄
--
-- 決策（2026-07-24）：取消孤兒欄位 author，保留 author_name 當唯一作者欄。
-- 前端無需同步修改，因為沒有任何程式引用 kms_documents.author；
-- kms-secure-docs 的 LIST_FIELDS / SEARCH_FIELDS 也只列 author_name，不受影響。
--
-- 唯一相依物件：view kms_expiring_documents（即將到期文件報表，前端與 edge function 皆未引用）
-- 原本 select 了 author，一併重建為引用 author_name（報表改顯示真人作者，更有意義）。

BEGIN;

DROP VIEW IF EXISTS public.kms_expiring_documents;

ALTER TABLE public.kms_documents DROP COLUMN IF EXISTS author;

CREATE VIEW public.kms_expiring_documents AS
  SELECT id,
         title,
         category,
         lang,
         author_name,
         valid_until,
         valid_until - CURRENT_DATE AS days_until_expiry
    FROM public.kms_documents
   WHERE status = 'published'::text
     AND valid_until IS NOT NULL
     AND valid_until <= (CURRENT_DATE + '30 days'::interval)
   ORDER BY valid_until;

COMMIT;
