-- 手機與配件 v1.05：類型字母 + 三位流水號（P001–P999）。
-- 僅修改 pd_device_assets 與其編號配置函式；所有關聯仍使用 UUID，不受編號改碼影響。

alter table public.pd_device_assets
  drop constraint if exists pd_device_assets_asset_code_check;

alter table public.pd_device_assets
  alter column asset_code type varchar(4)
  using substring(asset_code from 1 for 1) || lpad(substring(asset_code from 2)::integer::text, 3, '0');

alter table public.pd_device_assets
  add constraint pd_device_assets_asset_code_check
  check (asset_code ~ '^[A-Z][0-9]{3}$');

drop function if exists public.pd_device_allocate_code(char);

create function public.pd_device_allocate_code(p_type char(1)) returns varchar(4)
language plpgsql security definer set search_path=public as $$
declare n integer; candidate varchar(4);
begin
  perform pg_advisory_xact_lock(hashtext('pd_device_code_' || p_type));
  select coalesce(max(substring(asset_code from 2 for 3)::integer),0)+1 into n
  from public.pd_device_assets where type_code=p_type;
  if n > 999 then raise exception 'asset_code_capacity_exceeded'; end if;
  candidate := p_type || lpad(n::text,3,'0');
  return candidate;
end $$;
