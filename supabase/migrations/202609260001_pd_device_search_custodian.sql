-- 手機與配件：搜尋 RPC 加上「保管人」條件
--
-- 🔴 為什麼要動 RPC 而不是在 edge function 裡過濾：
--    pd_device_search 同時負責過濾、排序與分頁（limit/offset）。在函式端拿回
--    一頁再濾掉幾筆，總數與「載入下 30 筆」就會對不上，而且那等於把同一份
--    過濾邏輯寫成第二份 —— 本專案已經因為這種複製吃過好幾次虧。
--
-- p_custodian 是 users.emp_id（不是姓名）：姓名會改、會重複，工號不會。
create or replace function public.pd_device_search(
  p_query text default '', p_type text default '', p_status text default '',
  p_owner text default '', p_include_retired boolean default false,
  p_limit integer default 30, p_offset integer default 0,
  p_custodian text default ''
) returns table(asset_id uuid, score numeric, total_count bigint)
language sql stable security definer set search_path=public,extensions as $$
  with filtered as (
    select a.*,
      case when trim(coalesce(p_query,''))='' then 0::numeric
        when lower(a.asset_code)=lower(trim(p_query)) then 100
        when a.search_text like '%'||lower(trim(p_query))||'%' then 60
        else greatest(0, similarity(a.search_text,lower(trim(p_query)))*40)::numeric end as rank_score
    from public.pd_device_assets a
    where (p_include_retired or a.status <> 'retired')
      and (p_type='' or a.type_code=p_type)
      and (p_status='' or a.status=p_status)
      and (p_owner='' or a.ownership_unit=p_owner)
      and (coalesce(p_custodian,'')='' or a.custodian_emp_id=p_custodian)
      and (trim(coalesce(p_query,''))='' or a.search_text % lower(trim(p_query)) or a.search_text like '%'||lower(trim(p_query))||'%')
  ), counted as (select *, count(*) over() total from filtered)
  select id, rank_score, total from counted
  order by
    case when trim(coalesce(p_query,''))='' then case status when 'available' then 0 else 1 end end,
    case when trim(coalesce(p_query,''))<>'' then rank_score end desc,
    type_code, asset_code
  limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)
$$;

-- 🔴 p_custodian 放在參數清單的最後、且有預設值：pd-devices-api 目前用具名參數
--    呼叫，但舊版函式若還在被別處用位置參數呼叫，加在中間會整個錯位。
