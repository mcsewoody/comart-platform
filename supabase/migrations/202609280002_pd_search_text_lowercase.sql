-- Product Finder 2.35：讓 search_text 的 trigram 索引真正被用到。
--
-- 🔴 `pd_mfg_documents_search_trgm_idx` 建在 `gin(search_text gin_trgm_ops)`，
--    但三代 RPC（202608300001 / 202609130006 / 202609130008）查的都是
--    `lower(d.search_text)`。Postgres 不會拿 col 上的索引服務 lower(col) 的
--    條件，所以這兩個索引自 2026-08-30 建立以來從來沒生效過 —— 每次搜尋是
--    全表掃描，再 cross join 乘上最多 12 個語言變體。
--
-- 修法不是再加一個 `gin(lower(search_text))` 表達式索引：analysis 完成後
-- search_text 會被塞進最多 300 KB 的文件內文（pd_worker/run.py 的 path_context），
-- 再長一份 GIN 出來只是把索引維護成本變兩倍。
--
-- 改成把欄位正規化成小寫，現有索引直接可用：
--   1. trigger 在 DB 層保證。寫入路徑有三處（completeUpload、updateDocument、
--      worker 的 path_context），放在應用層任何一處漏掉都會破壞不變量
--   2. 回填既有資料
--   3. RPC 的 `lower(d.search_text)` 改成 `d.search_text` —— 查詢詞在
--      input_queries 裡本來就已經 lower 過了
--
-- 🔴 其他欄位（title、keywords、category_path…）的 lower() **保留**：它們沒有
--    trgm 索引，那裡的 lower() 是為了大小寫不敏感比對，拿掉會改變行為。

begin;

create or replace function public.pd_documents_lower_search_text()
returns trigger language plpgsql as $$
begin
  new.search_text := lower(coalesce(new.search_text, ''));
  return new;
end;
$$;

drop trigger if exists pd_mfg_documents_lower_search_text on public.pd_mfg_documents;
create trigger pd_mfg_documents_lower_search_text
  before insert or update of search_text on public.pd_mfg_documents
  for each row execute function public.pd_documents_lower_search_text();

drop trigger if exists pd_buy_documents_lower_search_text on public.pd_buy_documents;
create trigger pd_buy_documents_lower_search_text
  before insert or update of search_text on public.pd_buy_documents
  for each row execute function public.pd_documents_lower_search_text();

-- 只改真的有大寫的列：search_text 的 TOAST 值很大，不必要的 rewrite 很貴
update public.pd_mfg_documents set search_text = lower(search_text)
  where search_text <> lower(search_text);
update public.pd_buy_documents set search_text = lower(search_text)
  where search_text <> lower(search_text);


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
        else greatest(similarity(d.search_text, iq.q) * 180, 0)
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
      and (iq.q = '' or d.search_text like '%' || iq.q || '%' or d.search_text % iq.q)
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
        else coalesce(greatest(similarity(d.search_text, nullif(iq.q, '')), 0), 0) * 180
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
      and (iq.q = '' or d.search_text like '%' || iq.q || '%' or d.search_text % iq.q)
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

commit;
