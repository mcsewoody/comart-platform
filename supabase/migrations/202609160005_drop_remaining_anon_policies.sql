-- ═══════════════════════════════════════════════════════════════════════
-- 移除另外四張表對 anon 的讀取 policy（2026-09-16）
--
-- 與 202609160004 同一個形狀：policy 名稱都叫「anon can read ...」、roles={public}，
-- 應是同一批、同一個想法下建的。移除前實測（公開 anon key，不必登入）：
--   · room_bookings  → 10 筆，含 **title（會議主題）、host_id、emails（與會者信箱清單）**  ← 最嚴重
--   · car_vehicles   → 2 筆，含車牌
--   · lib_books      → 500+ 筆書目
--   · lib_categories → 9 筆
--
-- 逐一排除過的使用者（同 202609160004 的列舉）：
--   ✅ Admin 子系統（會議室、公務車、圖書館）全部經 sb-proxy 的 service_role
--   ✅ 本 repo 唯一繞過 sb-proxy 的直接 REST 是 kms 的 rpc/increment_kms_view，
--      它是 SECURITY DEFINER，不吃 RLS
--   ✅ 新官網只用 web_products_public／web_news／enquiry
--
-- 🔴 **`web_*` 那一組刻意不動**：它們的 policy 都有 `is_web_editor()` 或
--    `web_editors` 成員檢查把關，設計是對的；`web_news_public_read`／
--    `web_pages_public_read` 的 `status='live'` 與 `web_enquiries_anon_insert`
--    是官網要的公開行為。
--
-- 還原指令：
--   create policy "anon can read room_bookings"  on public.room_bookings  for select to public using (true);
--   create policy "anon can read car_vehicles"   on public.car_vehicles   for select to public using (true);
--   create policy "anon can read lib_books"      on public.lib_books      for select to public using (true);
--   create policy "anon can read lib_categories" on public.lib_categories for select to public using (true);
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "anon can read room_bookings"  on public.room_bookings;
drop policy if exists "anon can read car_vehicles"   on public.car_vehicles;
drop policy if exists "anon can read lib_books"      on public.lib_books;
drop policy if exists "anon can read lib_categories" on public.lib_categories;
