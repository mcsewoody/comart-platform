-- 手機與配件 v1.07：公司設備不再等待 Admin 核准或初始保管人確認。

alter table public.pd_device_assets
  alter column approval_status set default 'approved',
  alter column custodian_confirmed_at set default now(),
  alter column activated_at set default now(),
  alter column approved_at set default now();

update public.pd_device_assets
set approval_status = 'approved',
    approved_at = coalesce(approved_at, now()),
    custodian_confirmed_at = coalesce(custodian_confirmed_at, now()),
    activated_at = coalesce(activated_at, now()),
    updated_at = now()
where approval_status <> 'approved'
   or custodian_confirmed_at is null
   or activated_at is null;

