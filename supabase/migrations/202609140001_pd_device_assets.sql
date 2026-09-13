-- COMART Product Dev / 手機與配件（獨立邏輯資料庫）
-- 只建立 pd_device_* 物件與 pd-device-files bucket；不修改 KMS、Quotation、pd_mfg_*、pd_buy_*。

create extension if not exists pg_trgm;

create table if not exists public.pd_device_types (
  code char(1) primary key check (code ~ '^[A-Z]$'),
  name_zh text not null unique,
  name_en text not null,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text references public.users(emp_id)
);

insert into public.pd_device_types(code,name_zh,name_en,sort_order) values
  ('P','手機','Phone',10), ('W','手錶','Watch',20), ('E','耳機','Earphones',30),
  ('G','眼鏡','Glasses',40), ('S','喇叭','Speaker',50), ('T','平板','Tablet',60),
  ('N','筆電','Laptop',70), ('D','桌機','Desktop',80), ('X','配件','Accessory',90)
on conflict (code) do update set name_zh=excluded.name_zh,name_en=excluded.name_en,sort_order=excluded.sort_order;

create table if not exists public.pd_device_assets (
  id uuid primary key default gen_random_uuid(),
  asset_code char(3) not null unique check (asset_code ~ '^[A-Z][0-9]{2}$'),
  type_code char(1) not null references public.pd_device_types(code),
  original_name text,
  brand text not null,
  model text not null,
  official_model_code text,
  manufacturer_serial text,
  imei1 text,
  imei2 text,
  color text,
  specifications jsonb not null default '{}'::jsonb,
  aliases text[] not null default '{}'::text[],
  status text not null default 'available' check (status in ('available','in_use','maintenance','lost','retired')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  missing_fields text[] not null default '{}'::text[],
  custodian_emp_id text references public.users(emp_id),
  custodian_original_name text,
  custodian_confirmed_at timestamptz,
  ownership_unit text not null,
  current_location text,
  expected_available_date date,
  condition_note text,
  purchase_amount numeric(14,2),
  purchase_currency text check (purchase_currency is null or purchase_currency in ('USD','NTD','CNY','HKD','VND')),
  purchase_country text,
  purchase_vendor text,
  purchase_date date,
  warranty_expires_on date,
  image_storage_path text,
  image_source_url text,
  image_source_name text,
  image_retrieved_at timestamptz,
  receipt_storage_path text,
  source_note text,
  activated_at timestamptz,
  approved_at timestamptz,
  approved_by text references public.users(emp_id),
  lost_at date,
  lost_reason text,
  lost_note text,
  retired_at date,
  retirement_reason text check (retirement_reason is null or retirement_reason in ('scrapped','sold','donated','irreparable','other')),
  retirement_note text,
  created_at timestamptz not null default now(),
  created_by text not null references public.users(emp_id),
  updated_at timestamptz not null default now(),
  updated_by text not null references public.users(emp_id),
  search_text text not null default ''
);

create table if not exists public.pd_device_transfers (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.pd_device_assets(id) on delete restrict,
  transfer_type text not null check (transfer_type in ('temporary','permanent','return')),
  purpose text not null check (purpose in ('borrow','product_test','production','maintenance','other','return')),
  purpose_note text,
  project_ref text,
  from_emp_id text references public.users(emp_id),
  to_emp_id text not null references public.users(emp_id),
  requested_by text not null references public.users(emp_id),
  starts_on date,
  due_on date,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled','completed','awaiting_return')),
  from_approved_at timestamptz,
  to_approved_at timestamptz,
  conflict_detected boolean not null default false,
  receiver_condition text check (receiver_condition is null or receiver_condition in ('normal','used','damaged','missing_accessory')),
  condition_note text,
  condition_photo_path text,
  rejection_reason text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.pd_device_forced_transfer_approvals (
  transfer_id uuid not null references public.pd_device_transfers(id) on delete cascade,
  admin_emp_id text not null references public.users(emp_id),
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (transfer_id, admin_emp_id)
);

create table if not exists public.pd_device_repairs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.pd_device_assets(id) on delete restrict,
  sent_on date not null,
  reason text not null,
  vendor text,
  currency text check (currency is null or currency in ('USD','NTD','CNY','HKD','VND')),
  cost numeric(14,2),
  returned_on date,
  result text,
  created_by text not null references public.users(emp_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pd_device_inventory_checks (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.pd_device_assets(id) on delete restrict,
  inventory_year integer not null check (inventory_year between 2026 and 2200),
  result text not null check (result in ('held','abnormal','missing')),
  note text,
  confirmed_by text not null references public.users(emp_id),
  confirmed_at timestamptz not null default now(),
  unique(asset_id, inventory_year)
);

create table if not exists public.pd_device_audit_log (
  id bigint generated always as identity primary key,
  asset_id uuid references public.pd_device_assets(id) on delete restrict,
  transfer_id uuid references public.pd_device_transfers(id) on delete restrict,
  action text not null,
  actor_emp_id text not null references public.users(emp_id),
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.pd_device_reminder_log (
  reminder_key text primary key,
  reminder_type text not null,
  asset_id uuid references public.pd_device_assets(id) on delete restrict,
  transfer_id uuid references public.pd_device_transfers(id) on delete restrict,
  sent_to text[] not null,
  sent_at timestamptz not null default now()
);

create or replace function public.pd_device_refresh_search_text() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.search_text := lower(concat_ws(' ', new.asset_code, new.original_name, new.brand, new.model,
    new.official_model_code, new.manufacturer_serial, new.imei1, new.imei2, new.color,
    new.custodian_original_name, new.ownership_unit, new.current_location,
    array_to_string(new.aliases,' '), coalesce(new.specifications::text,'')));
  return new;
end $$;

drop trigger if exists pd_device_refresh_search_text_trg on public.pd_device_assets;
create trigger pd_device_refresh_search_text_trg before insert or update on public.pd_device_assets
for each row execute function public.pd_device_refresh_search_text();

create or replace function public.pd_device_allocate_code(p_type char(1)) returns char(3)
language plpgsql security definer set search_path=public as $$
declare n integer; candidate char(3);
begin
  perform pg_advisory_xact_lock(hashtext('pd_device_code_' || p_type));
  select coalesce(max(substring(asset_code from 2 for 2)::integer),0)+1 into n
  from public.pd_device_assets where type_code=p_type;
  if n > 99 then raise exception 'asset_code_capacity_exceeded'; end if;
  candidate := p_type || lpad(n::text,2,'0');
  return candidate;
end $$;

create or replace function public.pd_device_search(
  p_query text default '', p_type text default '', p_status text default '',
  p_owner text default '', p_include_retired boolean default false,
  p_limit integer default 30, p_offset integer default 0
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
      and (trim(coalesce(p_query,''))='' or a.search_text % lower(trim(p_query)) or a.search_text like '%'||lower(trim(p_query))||'%')
  ), counted as (select *, count(*) over() total from filtered)
  select id, rank_score, total from counted
  order by
    case when trim(coalesce(p_query,''))='' then case status when 'available' then 0 else 1 end end,
    case when trim(coalesce(p_query,''))<>'' then rank_score end desc,
    type_code, asset_code
  limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)
$$;

create index if not exists pd_device_assets_type_status_idx on public.pd_device_assets(type_code,status,asset_code);
create index if not exists pd_device_assets_custodian_idx on public.pd_device_assets(custodian_emp_id);
create index if not exists pd_device_assets_search_trgm_idx on public.pd_device_assets using gin(search_text extensions.gin_trgm_ops);
create index if not exists pd_device_transfers_asset_status_idx on public.pd_device_transfers(asset_id,status,requested_at desc);
create index if not exists pd_device_inventory_year_idx on public.pd_device_inventory_checks(inventory_year,asset_id);

alter table public.pd_device_types enable row level security;
alter table public.pd_device_assets enable row level security;
alter table public.pd_device_transfers enable row level security;
alter table public.pd_device_forced_transfer_approvals enable row level security;
alter table public.pd_device_repairs enable row level security;
alter table public.pd_device_inventory_checks enable row level security;
alter table public.pd_device_audit_log enable row level security;
alter table public.pd_device_reminder_log enable row level security;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('pd-device-files','pd-device-files',false,10485760,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

comment on table public.pd_device_assets is 'Product Dev 手機與配件；一台實體設備一筆。';
comment on table public.pd_device_audit_log is '只經 pd-devices-api 寫入與供 Admin 查閱的不可變更稽核紀錄。';
