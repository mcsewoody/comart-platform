-- Product Finder v2.25: merge multilingual query variants in PostgreSQL so
-- total counts and 30-item pagination describe the complete deduplicated result.

create or replace function public.pd_mfg_search_documents_multilingual(
  p_queries text[] default array['']::text[],
  p_kind text default '',
  p_include_reference boolean default false,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table(document_id uuid, score numeric, match_reason text, total_count bigint)
language sql stable security definer set search_path = public, extensions as $$
  with input_queries as (
    select lower(trim(q.value)) q, q.ordinality::integer query_order
    from unnest(
      case when coalesce(cardinality(p_queries), 0) = 0
        then array['']::text[] else p_queries end
    ) with ordinality as q(value, ordinality)
  ), scored as (
    select d.id,
      d.rank_weight,
      iq.q,
      iq.query_order,
      case
        when iq.q = '' then 100
        when lower(d.title) = iq.q then 1000
        when lower(d.title) like '%' || iq.q || '%' then 850
        when lower(array_to_string(d.keywords, ' ')) like '%' || iq.q || '%' then 700
        when lower(array_to_string(d.category_path, ' ')) like '%' || iq.q || '%' then 620
        when lower(coalesce(d.source_factory, '')) like '%' || iq.q || '%' then 560
        when lower(d.relative_path) like '%' || iq.q || '%' then 520
        when lower(d.extracted_text) like '%' || iq.q || '%' then 220
        else greatest(similarity(lower(d.search_text), iq.q) * 180, 0)
      end base_score,
      case
        when iq.q = '' then 'recent'
        when lower(d.title) = iq.q then 'exact_filename'
        when lower(d.title) like '%' || iq.q || '%' then 'filename'
        when lower(array_to_string(d.keywords, ' ')) like '%' || iq.q || '%' then 'keyword'
        when lower(array_to_string(d.category_path, ' ')) like '%' || iq.q || '%' then 'category'
        when lower(coalesce(d.source_factory, '')) like '%' || iq.q || '%' then 'factory'
        when lower(d.relative_path) like '%' || iq.q || '%' then 'path'
        else 'content'
      end raw_match_reason,
      d.primary_document_date,
      d.source_modified_at
    from public.pd_mfg_documents d
    cross join input_queries iq
    where (coalesce(p_kind, '') = '' or d.document_kind = p_kind)
      and (p_include_reference or not d.is_reference)
      and (iq.q = '' or lower(d.search_text) like '%' || iq.q || '%' or lower(d.search_text) % iq.q)
  ), relevant as (
    select *,
      round((rank_weight * base_score * case when query_order = 1 then 1 else 0.94 end)::numeric, 2) weighted_score
    from scored
    where q = '' or raw_match_reason <> 'content' or rank_weight * base_score >= 200
  ), best as (
    select distinct on (id)
      id, weighted_score, query_order, raw_match_reason,
      primary_document_date, source_modified_at
    from relevant
    order by id, weighted_score desc, query_order
  ), counted as (
    select id, weighted_score, query_order, raw_match_reason,
      primary_document_date, source_modified_at, count(*) over() total_count
    from best
  )
  select id, weighted_score,
    case when query_order = 1 then raw_match_reason else 'cross_language' end,
    total_count
  from counted
  order by weighted_score desc, primary_document_date desc nulls last,
    source_modified_at desc nulls last, id
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.pd_buy_search_documents_multilingual(
  p_queries text[] default array['']::text[],
  p_supplier text default '',
  p_kind text default '',
  p_include_reference boolean default false,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table(document_id uuid, score numeric, match_reason text, total_count bigint)
language sql stable security definer set search_path = public, extensions as $$
  with input_queries as (
    select lower(trim(q.value)) q, q.ordinality::integer query_order,
      lower(trim(coalesce(p_supplier, ''))) supplier
    from unnest(
      case when coalesce(cardinality(p_queries), 0) = 0
        then array['']::text[] else p_queries end
    ) with ordinality as q(value, ordinality)
  ), scored as (
    select d.id,
      d.rank_weight,
      iq.q,
      iq.query_order,
      case
        when iq.q = '' and iq.supplier = '' then 100
        when iq.q <> '' and lower(d.title) = iq.q then 1000
        when iq.supplier <> '' and lower(d.supplier_name) = iq.supplier then 930
        when iq.supplier <> '' and lower(d.supplier_name) like '%' || iq.supplier || '%' then 900
        when iq.q <> '' and lower(d.title) like '%' || iq.q || '%' then 850
        when iq.q <> '' and lower(array_to_string(d.keywords, ' ')) like '%' || iq.q || '%' then 700
        when iq.q <> '' and lower(array_to_string(d.product_path, ' ')) like '%' || iq.q || '%' then 620
        when iq.q <> '' and lower(d.relative_path) like '%' || iq.q || '%' then 520
        when iq.q <> '' and lower(d.extracted_text) like '%' || iq.q || '%' then 220
        else coalesce(greatest(similarity(lower(d.search_text), nullif(iq.q, '')), 0), 0) * 180
      end base_score,
      case
        when iq.q = '' and iq.supplier = '' then 'recent'
        when iq.q <> '' and lower(d.title) = iq.q then 'exact_filename'
        when iq.supplier <> '' and lower(d.supplier_name) like '%' || iq.supplier || '%' then 'supplier'
        when iq.q <> '' and lower(d.title) like '%' || iq.q || '%' then 'filename'
        when iq.q <> '' and lower(array_to_string(d.keywords, ' ')) like '%' || iq.q || '%' then 'keyword'
        when iq.q <> '' and lower(array_to_string(d.product_path, ' ')) like '%' || iq.q || '%' then 'product_path'
        when iq.q <> '' and lower(d.relative_path) like '%' || iq.q || '%' then 'path'
        else 'content'
      end raw_match_reason,
      d.primary_document_date,
      d.source_modified_at
    from public.pd_buy_documents d
    cross join input_queries iq
    where (coalesce(p_kind, '') = '' or d.document_kind = p_kind)
      and (iq.supplier = '' or lower(d.supplier_name) like '%' || iq.supplier || '%')
      and (p_include_reference or not d.is_reference)
      and (iq.q = '' or lower(d.search_text) like '%' || iq.q || '%' or lower(d.search_text) % iq.q)
  ), relevant as (
    select *,
      round((rank_weight * base_score * case when query_order = 1 then 1 else 0.94 end)::numeric, 2) weighted_score
    from scored
    where q = '' or raw_match_reason <> 'content' or rank_weight * base_score >= 200
  ), best as (
    select distinct on (id)
      id, weighted_score, query_order, raw_match_reason,
      primary_document_date, source_modified_at
    from relevant
    order by id, weighted_score desc, query_order
  ), counted as (
    select id, weighted_score, query_order, raw_match_reason,
      primary_document_date, source_modified_at, count(*) over() total_count
    from best
  )
  select id, weighted_score,
    case when query_order = 1 then raw_match_reason else 'cross_language' end,
    total_count
  from counted
  order by weighted_score desc, primary_document_date desc nulls last,
    source_modified_at desc nulls last, id
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.pd_mfg_search_documents_multilingual(text[],text,boolean,integer,integer)
  from public, anon, authenticated;
revoke all on function public.pd_buy_search_documents_multilingual(text[],text,text,boolean,integer,integer)
  from public, anon, authenticated;
grant execute on function public.pd_mfg_search_documents_multilingual(text[],text,boolean,integer,integer)
  to service_role;
grant execute on function public.pd_buy_search_documents_multilingual(text[],text,text,boolean,integer,integer)
  to service_role;
