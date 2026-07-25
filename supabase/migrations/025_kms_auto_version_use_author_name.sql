-- 025_kms_auto_version_use_author_name.sql
--
-- 024 移除 kms_documents.author 後，trigger 函式 kms_auto_version() 仍引用 new.author，
-- 導致任何會改動 body/title 的更新都在 trigger 執行期報錯：
--   record "new" has no field "author"  (kms-write 回 400，前端存檔失敗)
--
-- 修正：版本紀錄的 changed_by 改用 new.author_name（真人作者，與其他 trigger 一致）。
-- 函式其餘邏輯不變。

CREATE OR REPLACE FUNCTION public.kms_auto_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.body <> new.body or old.title <> new.title then
    insert into kms_doc_versions
      (doc_id, version_no, title, body, category, lang, status, changed_by)
    values
      (old.id, old.version, old.title, old.body,
       old.category, old.lang, old.status, new.author_name);
    new.version    := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$function$;
