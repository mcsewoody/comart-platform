-- ═══════════════════════════════════════════════════════════════════════
-- 還原 web_products_* 的公開存取（2026-09-16，緊急）
--
-- 🔴 **202609160002 弄壞了新官網的產品頁，這是我判斷錯誤造成的。**
--    當時我查 www.comart.com.tw，看到是 Wix 站、對 Supabase 零引用，
--    又試了 comartgroup.github.io 根路徑拿到 404，就下結論「官網不碰這些 view」。
--    **錯在只試了根路徑就下結論** —— 新官網在
--    https://comartgroup.github.io/www/ ，而且 www.comart.com.tw 那個 Wix 站是舊的。
--    新官網 `products/assets/js/products.js` 正是用 anon key 打 web_products_public。
--
-- 🔴 **web_products_public 是 SECURITY DEFINER 而且對 anon 開放，是刻意的設計**，
--    不是漏洞：它就是官網的公開產品 API。底層 `products` 表的 RLS 對 anon 全關，
--    view 用 definer 權限繞過去、只吐出「可公開的產品欄位」—— 那正是這種 view 的用途。
--    Supabase Security Advisor 會一直報它，**那是已知且刻意的**，不要再「修」它。
--
--    所以兩件事都要還原：
--      · security_invoker 關回去（開著的話 view 會照 anon 的 RLS 跑 → 回 0 筆，
--        grant 給回去也沒用，這是比 revoke 更隱蔽的壞法）
--      · grant select 給 anon
-- ═══════════════════════════════════════════════════════════════════════

alter view public.web_products_public set (security_invoker = off);
alter view public.web_products_admin  set (security_invoker = off);

grant select on public.web_products_public to anon;
-- web_products_admin 在 202609160002 之前 anon 就沒有 select 權限（實測回 401），
-- 故**不還原它的 grant** —— 只還原 security_invoker，保持原狀。
