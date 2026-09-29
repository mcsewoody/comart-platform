-- pd_analysis_queue_status() 漏了 revoke（2.35 我加這支 RPC 時忘的）。
--
-- 🔴 Postgres 的函式**預設就是 EXECUTE TO PUBLIC**，而它是 security definer，
--    所以用印在每一頁 HTML 原始碼裡的 anon key 就呼叫得到。實測回：
--      [{"dataset":"mfg","queued":3,...,"completed":929},
--       {"dataset":"buy",...,"completed":266}]
--
--    洩漏的只是數字（不含任何文件內容或人名），但同一批 pd_* RPC
--    （pd_claim_jobs / pd_finish_job / 兩支搜尋）全都有明確 revoke，
--    漏掉這一支純粹是我寫 migration 時忘了，不是刻意放行。
--
--    這與 2026-09-16 那批 anon 清除是同一個教訓：**新增資料庫物件時，
--    預設權限比你以為的寬。**

begin;

revoke all on function public.pd_analysis_queue_status() from public, anon, authenticated;
grant execute on function public.pd_analysis_queue_status() to service_role;

commit;
