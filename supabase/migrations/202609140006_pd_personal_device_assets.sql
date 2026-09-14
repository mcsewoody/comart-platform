-- 手機與配件 v1.06：個人資產調查。
-- 與公司資產分表管理，只共用 Platform users 與 pd_device_types。

create table if not exists public.pd_personal_device_assets (
  id uuid primary key default gen_random_uuid(),
  owner_emp_id text not null references public.users(emp_id),
  owner_original_name text not null,
  type_code char(1) not null references public.pd_device_types(code),
  brand text not null,
  model text not null,
  color text,
  image_storage_path text,
  image_source_url text,
  image_source_name text,
  image_retrieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text not null default ''
);

create table if not exists public.pd_personal_device_activity (
  id bigint generated always as identity primary key,
  action text not null check (action in ('created','updated','image_uploaded','deleted')),
  created_at timestamptz not null default now()
);

create or replace function public.pd_personal_device_refresh_search_text() returns trigger
language plpgsql as $$
declare type_terms text; color_terms text;
begin
  type_terms := case new.type_code
    when 'P' then '手機 手机 phone smartphone mobile điện thoại'
    when 'W' then '手錶 手表 watch smartwatch đồng hồ'
    when 'E' then '耳機 耳机 earphone earbuds headphone tai nghe'
    when 'G' then '眼鏡 眼镜 glasses kính'
    when 'S' then '喇叭 音箱 speaker loa'
    when 'T' then '平板 平板电脑 tablet ipad máy tính bảng'
    when 'N' then '筆電 笔记本 筆記型電腦 laptop notebook máy tính xách tay'
    when 'D' then '桌機 台式机 桌上型電腦 desktop máy tính để bàn'
    when 'X' then '配件 附件 accessory accessories phụ kiện'
    else '' end;
  color_terms := case
    when lower(coalesce(new.color,'')) ~ '(白|white|trắng)' then '白色 白 white trắng'
    when lower(coalesce(new.color,'')) ~ '(黑|black|đen)' then '黑色 黑 black đen'
    when lower(coalesce(new.color,'')) ~ '(紅|红|red|đỏ)' then '紅色 红色 紅 red đỏ'
    when lower(coalesce(new.color,'')) ~ '(藍|蓝|blue|xanh dương)' then '藍色 蓝色 藍 blue xanh dương'
    when lower(coalesce(new.color,'')) ~ '(綠|绿|green|xanh lá)' then '綠色 绿色 綠 green xanh lá'
    when lower(coalesce(new.color,'')) ~ '(金|gold|vàng)' then '金色 金 gold vàng'
    when lower(coalesce(new.color,'')) ~ '(銀|银|silver|bạc)' then '銀色 银色 銀 silver bạc'
    when lower(coalesce(new.color,'')) ~ '(紫|purple|tím)' then '紫色 紫 purple tím'
    when lower(coalesce(new.color,'')) ~ '(灰|gray|grey|xám)' then '灰色 灰 gray grey xám'
    else coalesce(new.color,'') end;
  new.updated_at := now();
  new.search_text := lower(concat_ws(' ', new.owner_original_name, new.brand, new.model, type_terms, color_terms));
  return new;
end $$;

drop trigger if exists pd_personal_device_refresh_search_text_trg on public.pd_personal_device_assets;
create trigger pd_personal_device_refresh_search_text_trg before insert or update on public.pd_personal_device_assets
for each row execute function public.pd_personal_device_refresh_search_text();

create or replace function public.pd_personal_device_search(
  p_query text default '', p_type text default '', p_owner text default '',
  p_include_inactive boolean default false,
  p_limit integer default 30, p_offset integer default 0
) returns table(asset_id uuid, score numeric, total_count bigint)
language sql stable security definer set search_path=public,extensions as $$
  with filtered as (
    select a.*,
      case when trim(coalesce(p_query,''))='' then 0::numeric
        when lower(a.model)=lower(trim(p_query)) then 100
        when lower(concat_ws(' ',a.brand,a.model))=lower(trim(p_query)) then 95
        when a.search_text like '%'||lower(trim(p_query))||'%' then 60
        else greatest(0, similarity(a.search_text,lower(trim(p_query)))*40)::numeric end as rank_score
    from public.pd_personal_device_assets a
    join public.users u on u.emp_id=a.owner_emp_id
    where (p_include_inactive or (u.active is true and coalesce(u.status,'') not in ('disabled','resigned')))
      and (p_type='' or a.type_code=p_type)
      and (p_owner='' or a.owner_emp_id=p_owner)
      and (trim(coalesce(p_query,''))='' or a.search_text % lower(trim(p_query)) or not exists (
        select 1 from regexp_split_to_table(lower(trim(p_query)), '\s+') token
        where token<>'' and a.search_text not like '%'||token||'%'
      ))
  ), counted as (select *,count(*) over() total from filtered)
  select id,rank_score,total from counted
  order by
    case when trim(coalesce(p_query,''))<>'' then rank_score end desc,
    updated_at desc,id
  limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)
$$;

create index if not exists pd_personal_device_owner_idx on public.pd_personal_device_assets(owner_emp_id,updated_at desc);
create index if not exists pd_personal_device_type_idx on public.pd_personal_device_assets(type_code,updated_at desc);
create index if not exists pd_personal_device_search_trgm_idx on public.pd_personal_device_assets using gin(search_text extensions.gin_trgm_ops);

alter table public.pd_personal_device_assets enable row level security;
alter table public.pd_personal_device_activity enable row level security;

comment on table public.pd_personal_device_assets is 'Product Dev 個人資產調查；本人自行登錄，不納入公司資產管理。';
