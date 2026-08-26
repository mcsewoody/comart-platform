-- 公務車預約：補上「實際出發／實際歸還時間」欄位（2026-08-26）
--
-- 🔴 前端從 v2.31 起就在寫 actual_start / actual_end（startUse / doReturn），
--    但 car_bookings 從來沒有這兩個欄位（這張表不是由 migration 建的），
--    而 sbSaveCarBk() 的欄位映射也沒有把它們送出去 ——
--    所以「實際歸還時間」一直只活在瀏覽器的 localStorage 快取裡，
--    下次 loadCarFromSB() 從 Supabase 載入就整個消失。
--    看板的「最後歸還」讀的是 b.actual_end，因此一直退回顯示「預約的結束時間」，
--    而不是真正的還車時間。
--
-- 型別用 timestamptz，與既有的 start_dt / end_dt 一致：那兩欄的既有資料是以
-- 「當地時間的字面值」寫入的（前端送 'YYYY-MM-DD HH:mm'，不帶時區），
-- 讀回來 slice(0,16) 又得到同一個字面值。這裡沿用同一套寫法，
-- 才不會在同一張表裡出現兩種時間慣例。
alter table public.car_bookings add column if not exists actual_start timestamptz;
alter table public.car_bookings add column if not exists actual_end   timestamptz;

comment on column public.car_bookings.actual_start is '實際出發時間（按下「出發」的當地時間，字面值寫入，同 start_dt 慣例）';
comment on column public.car_bookings.actual_end   is '實際歸還時間（按下「歸還」的當地時間，字面值寫入，同 end_dt 慣例）';
