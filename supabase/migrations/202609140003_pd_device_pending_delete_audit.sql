-- 允許 Admin 永久刪除從未啟用的錯誤／重複資料，同時保留去識別化稽核紀錄。
alter table public.pd_device_audit_log drop constraint if exists pd_device_audit_log_asset_id_fkey;
alter table public.pd_device_audit_log add constraint pd_device_audit_log_asset_id_fkey
  foreign key(asset_id) references public.pd_device_assets(id) on delete set null;

alter table public.pd_device_audit_log drop constraint if exists pd_device_audit_log_transfer_id_fkey;
alter table public.pd_device_audit_log add constraint pd_device_audit_log_transfer_id_fkey
  foreign key(transfer_id) references public.pd_device_transfers(id) on delete set null;
