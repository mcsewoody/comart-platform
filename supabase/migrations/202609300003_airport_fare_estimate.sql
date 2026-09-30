-- collect() 會算一個 fareEstimate 存進紀錄（`b.fareEstimate = String(fareOf(b).total)`），
-- 建表時漏掉了這個欄位。
--
-- ⚠️ 它是**送出當下**用前端的價目表算出來的估價，不是實際請款金額：
--    夜間加價、舉牌、停靠點都算得進去，但旺季服務費、臨時取消的空趟費
--    都不在裡面（那些由廠商依個案計）。所以它只能當參考，不要拿來對帳。

begin;

alter table public.airport_bookings
  add column if not exists fare_estimate integer;

comment on column public.airport_bookings.fare_estimate is
  '送出當下的估價（含夜間／舉牌／停靠點），非實際請款金額';

commit;
