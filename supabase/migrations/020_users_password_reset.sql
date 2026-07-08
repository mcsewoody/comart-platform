-- Phase 1：強制密碼重設。密碼雜湊已於 2026-07-08 因 RLS 設定錯誤外洩，
-- 且原雜湊方案（SHA-256 + 固定鹽值）易被離線暴力破解，比照資安事件處理，
-- 要求全體現有帳號下次登入時強制設定新密碼。
--
-- must_change_pwd 欄位在前端 JS（saveUser）已存在對應邏輯多時，但從未真正
-- 建立資料庫欄位、也從未在登入流程強制執行——是先前未完成的半成品功能，
-- 這次一併補完。
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_pwd BOOLEAN NOT NULL DEFAULT false;

-- 全體現有帳號（含停用帳號，避免之後重新啟用時繞過）標記為必須改密碼
UPDATE public.users SET must_change_pwd = true;
