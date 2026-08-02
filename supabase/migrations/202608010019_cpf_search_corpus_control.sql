-- CPF search rescue: separate the searchable working corpus from reference
-- material without deleting source files, versions, or existing AI output.

alter table public.cpf_documents
  add column if not exists search_scope text not null default 'primary'
    check (search_scope in ('primary', 'reference', 'hidden')),
  add column if not exists search_scope_reason text;

alter table public.cpf_products
  add column if not exists search_scope text not null default 'primary'
    check (search_scope in ('primary', 'reference', 'hidden')),
  add column if not exists search_scope_reason text;

create index if not exists cpf_documents_search_scope_idx
  on public.cpf_documents(search_scope) where deleted_at is null;
create index if not exists cpf_products_search_scope_idx
  on public.cpf_products(search_scope) where deleted_at is null;

-- These rules are deliberately conservative and reversible.  Nothing is
-- deleted: the user can later expose reference material in a dedicated view.
update public.cpf_documents
set search_scope = 'hidden',
    search_scope_reason = '展後整理、相簿或 phase out：保留來源，不列入預設搜尋'
where deleted_at is null
  and (
    source_path ilike '_其他/展後整理/%'
    or source_path ilike '_其他/phase out/%'
    or source_path ilike '%/LINE_ALBUM%'
  );

update public.cpf_documents
set search_scope = 'reference',
    search_scope_reason = '供應商、外購、RFP 或一般其他資料：保留為參考，不列入預設搜尋'
where deleted_at is null
  and search_scope = 'primary'
  and (
    source_path ilike '_供應商/%'
    or source_path ilike '_外購/%'
    or source_path ilike '_RFP/%'
    or source_path ilike '_其他/%'
  );

-- A product is primary only when it has a usable identity signal.  Existing
-- links and AI output remain intact; this changes search visibility only.
update public.cpf_products p
set search_scope = case
      when not exists (
        select 1 from public.cpf_product_documents pd
        join public.cpf_documents d on d.id = pd.document_id
        where pd.product_id = p.id and d.deleted_at is null
          and d.search_scope <> 'hidden'
      ) then 'hidden'
      when coalesce(array_length(p.model_numbers, 1), 0) > 0
        or p.category_id is not null
        or p.confirmation_status = 'human_confirmed' then 'primary'
      else 'reference'
    end,
    search_scope_reason = case
      when not exists (
        select 1 from public.cpf_product_documents pd
        join public.cpf_documents d on d.id = pd.document_id
        where pd.product_id = p.id and d.deleted_at is null
          and d.search_scope <> 'hidden'
      ) then '所有來源均為封存／照片資料'
      when coalesce(array_length(p.model_numbers, 1), 0) > 0
        or p.category_id is not null
        or p.confirmation_status = 'human_confirmed' then '具型號、分類或人工確認身分'
      else '缺少型號、分類與人工確認身分，保留為參考'
    end
where p.deleted_at is null;

insert into public.cpf_audit_log(action, entity_type, details)
values (
  'search_corpus_classified',
  'cpf_search',
  jsonb_build_object(
    'rule', '202608010019',
    'note', 'Reversible search-scope classification; no source or AI data deleted'
  )
);
