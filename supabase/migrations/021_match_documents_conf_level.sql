-- match_documents 原本沒有機密等級awareness，向量搜尋會把機密等級 2/3
-- 文件的完整 body 直接回傳給呼叫端（就算前端事後過濾掉不顯示，原始回應
-- 已經整包送到瀏覽器，開發者工具 Network 分頁看得到）。
-- 加上 max_conf_level 參數，由伺服器端（kms-secure-docs function）依驗證過
-- 的角色代入，未提供時預設 1（最低權限），確保直接呼叫此 RPC 也是安全的。
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.4,
  match_count integer DEFAULT 5,
  filter_lang text DEFAULT NULL::text,
  filter_category text DEFAULT NULL::text,
  max_conf_level integer DEFAULT 1,
  viewer_name text DEFAULT NULL::text
)
RETURNS TABLE(id uuid, title text, body text, category text, lang text, status text, version integer, updated_at timestamp with time zone, similarity double precision)
LANGUAGE sql
STABLE
AS $function$
  select
    id, title, body, category, lang, status, version, updated_at,
    1 - (embedding <=> query_embedding) as similarity
  from kms_documents
  where
    status = 'published'
    and embedding is not null
    and 1 - (embedding <=> query_embedding) > match_threshold
    and (filter_lang     is null or lang     = filter_lang)
    and (filter_category is null or category = filter_category)
    and (coalesce(conf_level,1) <= max_conf_level or (viewer_name is not null and author_name = viewer_name))
  order by similarity desc
  limit match_count;
$function$
