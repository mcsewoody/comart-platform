-- Product Finder 2.35：AI 佇列狀態從 10 次查詢併成 1 次。
--
-- 🔴 舊版 analysisLibraryStatus 對每個資料庫各發 5 個 count(*)（queued /
--    processing / failed<3 / failed>=3 / completed），兩個資料庫就是 10 次往返，
--    而前端在分析頁每 15 秒 poll 一次。統計上很明顯：
--      pd_mfg_jobs  929 列 → 10,603 次 seq scan
--      pd_buy_jobs  266 列 → 10,332 次 seq scan
--
-- count(*) filter (...) 讓五個分組共用同一次掃描，兩個資料庫各掃一次就夠。

create or replace function public.pd_analysis_queue_status()
returns table(
  dataset text,
  queued bigint,
  processing bigint,
  retryable_failed bigint,
  blocked_failed bigint,
  completed bigint
)
language sql stable security definer set search_path = public as $$
  select 'mfg'::text,
    count(*) filter (where status = 'queued'),
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'failed' and attempts < 3),
    count(*) filter (where status = 'failed' and attempts >= 3),
    count(*) filter (where status = 'completed')
  from public.pd_mfg_jobs
  union all
  select 'buy'::text,
    count(*) filter (where status = 'queued'),
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'failed' and attempts < 3),
    count(*) filter (where status = 'failed' and attempts >= 3),
    count(*) filter (where status = 'completed')
  from public.pd_buy_jobs;
$$;
