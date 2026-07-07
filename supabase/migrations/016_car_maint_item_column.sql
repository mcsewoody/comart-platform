-- 保養記錄的「保養項目」欄位：前端一直有收集（mtit 必填），但表上沒有此欄，
-- 導致補上 SB 同步時無處可存
ALTER TABLE car_maint_logs
  ADD COLUMN IF NOT EXISTS item TEXT;
