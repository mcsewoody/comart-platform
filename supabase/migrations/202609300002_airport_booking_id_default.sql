-- 預約編號由 DB 產生，不讓前端指定。
--
-- 🔴 原系統是在**前端**算 `已有筆數 + 1`：
--      const seq = a.filter(x => x.id.startsWith(prefix)).length + 1;
--    兩個人同一天同時送出會拿到同一個編號，而那個編號會印在給廠商的單據上。
--    airport_next_booking_id() 用 advisory lock 把同一天的號碼序列化；
--    設成 default 之後前端連送都不必送（sb-proxy 也會把它刪掉）。

begin;

alter table public.airport_bookings
  alter column id set default public.airport_next_booking_id();

commit;
