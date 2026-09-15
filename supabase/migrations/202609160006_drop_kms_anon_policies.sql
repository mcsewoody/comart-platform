-- ═══════════════════════════════════════════════════════════════════════
-- 移除五張 KMS 表對 anon 的讀取 policy（2026-09-16）
--
-- 🔴 **這一批是全面實測掃描才抓到的，SQL 查詢漏了。**
--    我先前查「有 policy 放行 anon 的表」時，條件寫成
--    `roles::text like '%authenticated%' or roles::text = '{public}'` ——
--    **漏掉 `{anon}`**。這幾張的 policy 角色正是 `{anon}`。
--    教訓：**要證明「沒有別的洞」，靠實際打一遍比靠 SQL 條件可靠** ——
--    查詢條件本身就可能有洞。最後的驗證一律用 anon key 掃過每一張表。
--
-- 移除前實測（公開 anon key，不必登入）：
--   · kms_snapshots     → 400+ 筆文件快照，含 **完整 body**  ← 最嚴重
--     （202609160004 關掉 kms_documents 的前門，內容卻從快照表整批流出去）
--   · kms_comments      → 8 筆，含作者與內文
--   · kms_experts       → 2 筆，含 contact 聯絡方式
--   · kms_categories    → 12 筆分類（低敏感）
--   · kms_product_lines → 9 筆產品線（低敏感）
--
-- KMS 需要 Portal session 才能進，所有讀寫都經 sb-proxy／kms-secure-docs
-- （service_role，繞過 RLS），不需要任何 anon policy。
--
-- 還原指令（逐條，policy 名稱如下）：
--   kms_categories:    "anon read all" / "anon read categories"
--   kms_comments:      "anon read comments"
--   kms_experts:       "anon read experts"
--   kms_product_lines: "anon read product lines"   using (active = true)
--   kms_snapshots:     "anon read all"
--   例：create policy "anon read comments" on public.kms_comments for select to anon using (true);
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "anon read all"            on public.kms_snapshots;
drop policy if exists "anon read comments"       on public.kms_comments;
drop policy if exists "anon read experts"        on public.kms_experts;
drop policy if exists "anon read all"            on public.kms_categories;
drop policy if exists "anon read categories"     on public.kms_categories;
drop policy if exists "anon read product lines"  on public.kms_product_lines;
