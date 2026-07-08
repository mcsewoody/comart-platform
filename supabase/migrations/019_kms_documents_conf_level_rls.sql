-- KMS 機密文件圍堵：kms_documents 原本的 "anon read all" 政策（qual: true）
-- 讓任何持有公開 anon key 的人都能直接讀走機密等級 2/3 文件全文，資料庫層級
-- 完全沒有依機密等級限制（前端的角色判斷只是 UI 層過濾，可被繞過）。
--
-- 2026-07-08：改為 anon 只能讀機密等級 1（一般）文件；KMS 前端已同步改為
-- 一律經 Cloudflare Worker（service-role，繞過 RLS）讀取，故 admin/dcc 角色
-- 透過正常 UI 使用不受影響，只有「越過前端、直接打 Supabase REST API」的
-- 存取會被擋在等級 1。
DROP POLICY IF EXISTS "anon read all" ON public.kms_documents;

CREATE POLICY "anon read level1 only" ON public.kms_documents
  FOR SELECT
  TO anon
  USING (COALESCE(conf_level, 1) <= 1);
