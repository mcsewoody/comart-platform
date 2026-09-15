-- ═══════════════════════════════════════════════════════════════════════
-- 六個 view 關掉對 anon 的曝光（2026-09-16，Woody 指定「全部擋住，含官網那兩個」）
--
-- Security Advisor 報的是 SECURITY DEFINER view：那種 view 用「建立者」的權限執行，
-- 因此**繞過查詢者的 RLS**。實測 anon 讀得到 kms_users(57)、web_products_public(335)、
-- kms_popular_documents(20)、kms_author_stats(22)。
--
-- 動手前確認過的事（這是本次唯一有「弄壞官網」風險的一步）：
--   · www.comart.com.tw 是 **Wix** 架的（wix-thunderbolt／parastorage），
--     產品來自 Wix Stores，整站對 tcvlnpgpuphdalzvmoyo 與 web_products 零引用。
--   · CLAUDE.md 提到的另一個來源 comartgroup.github.io 目前回 404。
--   · 本 repo 沒有任何地方用 anon 打這六個 view（KMS 走 sb-proxy 的 service_role）。
--
-- 兩件事一起做：
--   ① security_invoker = on —— 這才是 Advisor 那條錯誤的正解。view 改用
--      「查詢者」的權限執行，底層表的 RLS 就回來了，不再是繞過的通道。
--   ② revoke select from anon —— Woody 要求擋住，這層是明確的拒絕。
--
-- 🔴 **但這兩步都擋不住真正的洞**：kms_documents 有 policy `anon read level1 only`、
--    users 有 policy `anon can read users`（roles={public}）＋ 欄位授權，
--    **底層表本身就對 anon 開著**。擋掉 view 只是把大門旁邊的窗戶關上。
--    那兩條 policy 是有人刻意建的（不在本 repo 的 migrations 裡），
--    要不要拿掉必須另外決定 —— 見 CLAUDE.md 的說明。
-- ═══════════════════════════════════════════════════════════════════════

alter view public.kms_users              set (security_invoker = on);
alter view public.kms_popular_documents  set (security_invoker = on);
alter view public.kms_author_stats       set (security_invoker = on);
alter view public.kms_expiring_documents set (security_invoker = on);
alter view public.web_products_public    set (security_invoker = on);
alter view public.web_products_admin     set (security_invoker = on);

revoke select on public.kms_users              from anon;
revoke select on public.kms_popular_documents  from anon;
revoke select on public.kms_author_stats       from anon;
revoke select on public.kms_expiring_documents from anon;
revoke select on public.web_products_public    from anon;
revoke select on public.web_products_admin     from anon;
