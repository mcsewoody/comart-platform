-- meeting_rooms 是唯一沒有啟用 RLS 的 public 表（Supabase 安全警告 2026-07-06）。
-- 目前四個前端檔案皆無引用此表（admin 會議室模組改用前端寫死的房間清單），
-- 採用與 sites/departments/car_parkings 相同模式：只開 RLS、不設 policy，
-- 預設拒絕 anon/authenticated 存取，僅 Worker 的 service-role 金鑰可讀寫。
ALTER TABLE public.meeting_rooms ENABLE ROW LEVEL SECURITY;
