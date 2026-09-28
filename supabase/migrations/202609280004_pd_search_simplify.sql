-- Product Finder 2.37：把搜尋 RPC 裡三段「證明無效」的東西拿掉。
--
-- 這三件事互相牽連，所以一起改：
--
-- ① `iq.q = ''` 這個 disjunct 讓 trigram 索引永遠用不到
--    WHERE 原本是 `(iq.q = '' or d.search_text like ... or d.search_text % ...)`。
--    第一條只碰 cross join 的**另一邊**（input_queries），不碰 d。帶著這種 OR，
--    Postgres 沒辦法把任何一條轉成 d 上的 index condition —— 整條只能全表掃描。
--    2.35 把 lower(search_text) 正規化掉之後索引還是 Unused，原因就是這個。
--
--    🔴 而這條 disjunct 是**多餘的**：search_text 是 `not null default ''`，
--       q = '' 時 `search_text like '%' || '' || '%'` 就是 `like '%%'`，恆為真。
--       直接刪掉，語意完全等價，WHERE 變成單一 like 述詞 → GIN trgm 可用。
--
-- ② `d.search_text % iq.q`（similarity 運算子）是純成本、零效果
--    走到 similarity 的那條 base_score 最大是 similarity(≤1) * 180 = 180，
--    而下游 relevant 的門檻是 `rank_weight * base_score >= 200`，
--    rank_weight 的 CHECK 又是 `> 0 and <= 1`。180 < 200，**永遠過不了**。
--    也就是這個運算子讓列通過 WHERE，只為了在下一個 CTE 被丟掉。
--    （search-ranking.js 的註解自己寫了「at most 180」對門檻 200 —— 是知道的，
--      但條件留在 SQL 裡沒拿掉。那支檔案本身也是死碼，這個版本一起刪。）
--
-- ③ 評分用 extracted_text、過濾用 search_text，同一份 300 KB 掃兩遍
--    worker 把 extracted_text 整份接進 search_text（pd_worker/run.py 的 path_context），
--    所以 `lower(d.extracted_text) like ...` 是在掃一份**已經被掃過的內容的副本**，
--    而且 extracted_text 沒有任何索引，每列都要再 detoast 一次最多 300 KB。
--    能走到那個分支代表 WHERE 的 search_text like 已經成立，直接給 220 即可。
--
--    ⚠️ 唯一的行為差異：search_text 還含 summary_zh_tw / revision_label，
--       「只在 AI 摘要裡命中」的文件原本會落到 similarity 分支（→ 被丟掉），
--       現在會算成 content 220（→ 留下）。這是修正，不是退步 —— 摘要命中本來
--       就該算內文命中。
--
-- ④ 連帶：relevant 的 `where q = '' or raw_match_reason <> 'content' or
--    rank_weight * base_score >= 200` 現在恆為真（content 一律 220，
--    rank_weight 恆為 1），整個 CTE 併回 scored。
--
-- 🔴 rank_weight 保留但要知道它是什麼：全 repo **沒有任何一行寫入它**，
--    永遠是 default 1。它是預留的降權鉤子（例如把 is_reference 或舊版本壓低），
--    乘法留著沒有副作用。要真的用它，得先有寫入路徑，而且那會改變排序 ——
--    屬於產品決策，不在這支 migration 裡。

begin;

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
      round((d.rank_weight * case
        when iq.q = '' then 100
        when lower(d.title) = iq.q then 1000
        when lower(d.title) like '%' || iq.q || '%' then 850
        when lower(array_to_string(d.keywords, ' ')) like '%' || iq.q || '%' then 700
        when lower(array_to_string(d.category_path, ' ')) like '%' || iq.q || '%' then 620
        when lower(coalesce(d.source_factory, '')) like '%' || iq.q || '%' then 560
        when lower(d.relative_path) like '%' || iq.q || '%' then 520
        else 220
      end * case when iq.query_order = 1 then 1 else 0.94 end)::numeric, 2) weighted_score,
      iq.query_order,
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
      and d.search_text like '%' || iq.q || '%'
  ), best as (
    select distinct on (id)
      id, weighted_score, query_order, raw_match_reason,
      primary_document_date, source_modified_at
    from scored
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
      round((d.rank_weight * case
        when iq.q = '' and iq.supplier = '' then 100
        when iq.q <> '' and lower(d.title) = iq.q then 1000
        when iq.supplier <> '' and lower(d.supplier_name) = iq.supplier then 930
        when iq.supplier <> '' and lower(d.supplier_name) like '%' || iq.supplier || '%' then 900
        when iq.q <> '' and lower(d.title) like '%' || iq.q || '%' then 850
        when iq.q <> '' and lower(array_to_string(d.keywords, ' ')) like '%' || iq.q || '%' then 700
        when iq.q <> '' and lower(array_to_string(d.product_path, ' ')) like '%' || iq.q || '%' then 620
        when iq.q <> '' and lower(d.relative_path) like '%' || iq.q || '%' then 520
        else 220
      end * case when iq.query_order = 1 then 1 else 0.94 end)::numeric, 2) weighted_score,
      iq.query_order,
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
      and d.search_text like '%' || iq.q || '%'
  ), best as (
    select distinct on (id)
      id, weighted_score, query_order, raw_match_reason,
      primary_document_date, source_modified_at
    from scored
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
