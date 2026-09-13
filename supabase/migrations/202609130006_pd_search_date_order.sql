-- Product Finder v2.20: deterministic ranking by relevance, document/version date,
-- then the original source file modification date. Missing dates sort last.

create or replace function public.pd_mfg_search_documents(
  p_query text default '',
  p_kind text default '',
  p_include_reference boolean default false,
  p_limit integer default 100
)
returns table(document_id uuid, score numeric, match_reason text)
language sql stable security definer set search_path = public, extensions as $$
  with input as (
    select lower(trim(coalesce(p_query, ''))) q
  ), ranked as (
    select d.id,
      round((d.rank_weight * (
        case
          when i.q = '' then 100
          when lower(d.title) = i.q then 1000
          when lower(d.title) like '%' || i.q || '%' then 850
          when lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 700
          when lower(array_to_string(d.category_path, ' ')) like '%' || i.q || '%' then 620
          when lower(coalesce(d.source_factory, '')) like '%' || i.q || '%' then 560
          when lower(d.relative_path) like '%' || i.q || '%' then 520
          when lower(d.extracted_text) like '%' || i.q || '%' then 220
          else greatest(similarity(lower(d.search_text), i.q) * 180, 0)
        end
      ))::numeric, 2) score,
      case
        when i.q = '' then 'recent'
        when lower(d.title) = i.q then 'exact_filename'
        when lower(d.title) like '%' || i.q || '%' then 'filename'
        when lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 'keyword'
        when lower(array_to_string(d.category_path, ' ')) like '%' || i.q || '%' then 'category'
        when lower(coalesce(d.source_factory, '')) like '%' || i.q || '%' then 'factory'
        when lower(d.relative_path) like '%' || i.q || '%' then 'path'
        else 'content'
      end match_reason,
      d.primary_document_date,
      d.source_modified_at
    from public.pd_mfg_documents d cross join input i
    where (coalesce(p_kind, '') = '' or d.document_kind = p_kind)
      and (p_include_reference or not d.is_reference)
      and (i.q = '' or lower(d.search_text) like '%' || i.q || '%' or lower(d.search_text) % i.q)
  )
  select id, score, match_reason
  from ranked
  order by score desc, primary_document_date desc nulls last,
    source_modified_at desc nulls last, id
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

create or replace function public.pd_buy_search_documents(
  p_query text default '',
  p_supplier text default '',
  p_kind text default '',
  p_include_reference boolean default false,
  p_limit integer default 100
)
returns table(document_id uuid, score numeric, match_reason text)
language sql stable security definer set search_path = public, extensions as $$
  with input as (
    select lower(trim(coalesce(p_query, ''))) q,
           lower(trim(coalesce(p_supplier, ''))) supplier
  ), ranked as (
    select d.id,
      round((d.rank_weight * (
        case
          when i.q = '' and i.supplier = '' then 100
          when i.q <> '' and lower(d.title) = i.q then 1000
          when i.supplier <> '' and lower(d.supplier_name) = i.supplier then 930
          when i.q <> '' and lower(d.title) like '%' || i.q || '%' then 850
          when i.q <> '' and lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 700
          when i.q <> '' and lower(array_to_string(d.product_path, ' ')) like '%' || i.q || '%' then 620
          when i.q <> '' and lower(d.relative_path) like '%' || i.q || '%' then 520
          when i.q <> '' and lower(d.extracted_text) like '%' || i.q || '%' then 220
          else coalesce(greatest(similarity(lower(d.search_text), nullif(i.q, '')), 0), 0) * 180
        end
      ))::numeric, 2) score,
      case
        when i.q = '' and i.supplier = '' then 'recent'
        when i.q <> '' and lower(d.title) = i.q then 'exact_filename'
        when i.supplier <> '' and lower(d.supplier_name) = i.supplier then 'supplier'
        when i.q <> '' and lower(d.title) like '%' || i.q || '%' then 'filename'
        when i.q <> '' and lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 'keyword'
        when i.q <> '' and lower(array_to_string(d.product_path, ' ')) like '%' || i.q || '%' then 'product_path'
        when i.q <> '' and lower(d.relative_path) like '%' || i.q || '%' then 'path'
        else 'content'
      end match_reason,
      d.primary_document_date,
      d.source_modified_at
    from public.pd_buy_documents d cross join input i
    where (coalesce(p_kind, '') = '' or d.document_kind = p_kind)
      and (i.supplier = '' or lower(d.supplier_name) like '%' || i.supplier || '%')
      and (p_include_reference or not d.is_reference)
      and (i.q = '' or lower(d.search_text) like '%' || i.q || '%' or lower(d.search_text) % i.q)
  )
  select id, score, match_reason
  from ranked
  order by score desc, primary_document_date desc nulls last,
    source_modified_at desc nulls last, id
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

create index if not exists pd_mfg_documents_display_dates_idx
  on public.pd_mfg_documents (primary_document_date desc, source_modified_at desc);
create index if not exists pd_buy_documents_display_dates_idx
  on public.pd_buy_documents (primary_document_date desc, source_modified_at desc);
