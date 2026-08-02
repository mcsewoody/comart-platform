-- CPF v1.14: indexed, keyword-first candidate retrieval.  Search must never
-- scan every embedding before the user can see a result.

create index if not exists cpf_products_search_text_trgm_idx
  on public.cpf_products using gin (search_text extensions.gin_trgm_ops)
  where deleted_at is null;
create index if not exists cpf_documents_title_trgm_idx
  on public.cpf_documents using gin (title extensions.gin_trgm_ops)
  where deleted_at is null;
create index if not exists cpf_documents_source_path_trgm_idx
  on public.cpf_documents using gin (source_path extensions.gin_trgm_ops)
  where deleted_at is null;
create index if not exists cpf_document_versions_extracted_text_trgm_idx
  on public.cpf_document_versions using gin (extracted_text extensions.gin_trgm_ops);

create or replace function public.cpf_fast_search_documents(
  p_query text default '',
  p_include_reference boolean default false,
  p_limit integer default 200
)
returns table(document_id uuid, score double precision, match_reason text)
language sql stable security definer set search_path = public, extensions
as $$
  with q as (select trim(coalesce(p_query, '')) as value)
  select d.id,
    case
      when q.value = '' then 0.0
      when lower(d.title) = lower(q.value) then 3000.0
      when d.title ilike '%' || q.value || '%' then 2200.0
      when d.source_path ilike '%' || q.value || '%' then 1600.0
      when v.extracted_text ilike '%' || q.value || '%' then 800.0
      else 0.0
    end,
    case
      when q.value = '' then null
      when lower(d.title) = lower(q.value) then '檔名完全符合'
      when d.title ilike '%' || q.value || '%' then '檔名命中'
      when d.source_path ilike '%' || q.value || '%' then '來源路徑命中'
      when v.extracted_text ilike '%' || q.value || '%' then '文件全文命中'
      else null
    end
  from public.cpf_documents d
  join public.cpf_document_versions v on v.id = d.current_version_id
  cross join q
  where d.deleted_at is null
    and (d.search_scope = 'primary'
      or (p_include_reference and d.search_scope = 'reference'))
    and (q.value = ''
      or d.title ilike '%' || q.value || '%'
      or d.source_path ilike '%' || q.value || '%'
      or v.extracted_text ilike '%' || q.value || '%')
  order by 2 desc, d.updated_at desc
  limit least(greatest(p_limit, 1), 300);
$$;

create or replace function public.cpf_fast_search_products(
  p_query text default '',
  p_include_reference boolean default false,
  p_limit integer default 200
)
returns table(product_id uuid, score double precision, match_reason text)
language sql stable security definer set search_path = public, extensions
as $$
  with q as (select trim(coalesce(p_query, '')) as value)
  select p.id,
    case
      when q.value = '' then 0.0
      when exists (select 1 from unnest(p.model_numbers) m where lower(m) = lower(q.value)) then 3000.0
      when exists (select 1 from unnest(p.model_numbers) m where m ilike '%' || q.value || '%') then 2400.0
      when coalesce(p.name_original, '') ilike '%' || q.value || '%'
        or coalesce(p.name_zh_tw, '') ilike '%' || q.value || '%' then 1800.0
      when coalesce(p.search_text, '') ilike '%' || q.value || '%' then 900.0
      else 0.0
    end,
    case
      when q.value = '' then null
      when exists (select 1 from unnest(p.model_numbers) m where lower(m) = lower(q.value)) then '型號完全符合'
      when exists (select 1 from unnest(p.model_numbers) m where m ilike '%' || q.value || '%') then '型號命中'
      when coalesce(p.name_original, '') ilike '%' || q.value || '%'
        or coalesce(p.name_zh_tw, '') ilike '%' || q.value || '%' then '產品名稱命中'
      when coalesce(p.search_text, '') ilike '%' || q.value || '%' then '產品關鍵字命中'
      else null
    end
  from public.cpf_products p
  cross join q
  where p.deleted_at is null
    and (p.search_scope = 'primary'
      or (p_include_reference and p.search_scope = 'reference'))
    and (q.value = ''
      or exists (select 1 from unnest(p.model_numbers) m where m ilike '%' || q.value || '%')
      or coalesce(p.search_text, '') ilike '%' || q.value || '%')
  order by 2 desc, p.updated_at desc
  limit least(greatest(p_limit, 1), 300);
$$;

revoke all on function public.cpf_fast_search_documents(text, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.cpf_fast_search_products(text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.cpf_fast_search_documents(text, boolean, integer) to service_role;
grant execute on function public.cpf_fast_search_products(text, boolean, integer) to service_role;
