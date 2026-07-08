-- CRITICAL: users.pwd_hash（密碼雜湊）目前可被任何持有 anon key 的人直接讀取。
-- anon key 是四個前端系統的公開原始碼裡的固定字串，任何造訪網站的人都能取得，
-- 等同全公司員工密碼雜湊已公開曝光（2026-07-08 發現）。
--
-- 已查證：四個系統（Portal/Admin/KMS/Quotation）所有登入流程比對密碼時，
-- 都是透過 Cloudflare Worker（獨立於 anon key 的服務端權杖，繞過 RLS）取得
-- pwd_hash，完全不依賴 anon 角色的直接讀取權限。因此收回 anon/authenticated
-- 對 pwd_hash 欄位的讀取權限，不影響任何現有登入功能。
--
-- 做法：整張表的 SELECT 授權收回，再明確重新授權除了 pwd_hash 以外的所有欄位，
-- 避免「先整欄撤銷再單獨補欄位」在極端情況下語意不明確的問題。
REVOKE SELECT ON public.users FROM anon, authenticated;

GRANT SELECT (
  id, emp_id, name_en, name_zh, role, dept, site, email, mobile, ext,
  title_en, title_zh, avatar_url, active, created_at, updated_at,
  bio_zh, bio_en, expertise_zh, expertise_en
) ON public.users TO anon, authenticated;
