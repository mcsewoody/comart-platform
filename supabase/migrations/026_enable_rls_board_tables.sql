-- 026_enable_rls_board_tables.sql
--
-- Supabase 安全顧問（2026-07-26）：biz_meeting_minutes / weekly_minutes / woody_reports
-- 三張 Board 子系統資料表未啟用 RLS，任何人拿前端可見的 anon key 直接打 PostgREST
-- 即可讀寫刪全部資料（rls_disabled_in_public，CRITICAL）。
--
-- 這三張表的所有存取都經 sb-proxy edge function（注入 service_role、驗 x-session 簽章），
-- 而 service_role 會繞過 RLS。故啟用 RLS、且「不」加任何 anon policy，即可：
--   * 擋掉以 anon key 直連 REST 的未授權讀寫刪
--   * Board 經 sb-proxy 的正常存取完全不受影響
-- 這與其餘資料表（rls=true、多數 policies=0）採用的鎖定模型一致。

ALTER TABLE public.biz_meeting_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_minutes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.woody_reports       ENABLE ROW LEVEL SECURITY;
