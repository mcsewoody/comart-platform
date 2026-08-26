-- 公務車：一輛車同時只能有一筆「使用中」的預約（2026-08-26）
--
-- 前端 v2.37 已在 startUse() 硬擋，但那是 UI 層的守衛 —— 改前端程式碼、
-- 或任何一條沒改到的寫入路徑都繞得過。這個 partial unique index 是真正的牆：
-- service_role 繞得過 RLS，但**繞不過 constraint**
-- （同 premortem_summary_audit trigger 的道理）。
--
-- 為什麼會需要這道牆：2026-08-26 實際發生一輛車兩筆同時 active。根因是歸還沒有寫進
-- 資料庫而畫面顯示成功（admin v2.37 修好），但只要還有任何一條寫入路徑會安靜失敗，
-- 同一種爛資料就還會再長出來。
--
-- ⚠️ 建立索引前先確認沒有既存的重複，否則索引會建不起來而且錯誤訊息看不出是哪一台車。
--    下面這段會把衝突的車輛名稱列出來，請先到 admin「用車記錄」把已經結束的那幾筆歸還。
do $$
declare
  r    record;
  msg  text := '';
begin
  for r in
    select b.vehicle_id, count(*) as c,
           coalesce(max(v.name), '(未知車輛)') as vname,
           coalesce(max(v.plate), '') as plate
      from public.car_bookings b
      left join public.car_vehicles v on v.id = b.vehicle_id
     where b.status = 'active'
     group by b.vehicle_id
    having count(*) > 1
  loop
    msg := msg || format('%s %s → %s 筆; ', r.vname, r.plate, r.c);
  end loop;
  if msg <> '' then
    raise exception E'仍有車輛存在多筆「使用中」預約，索引無法建立。\n請先到 admin →公務車→用車記錄，狀態篩「使用中」，把已經結束的那幾筆按歸還，然後重新執行這個 migration。\n衝突車輛：%', msg;
  end if;
end $$;

create unique index if not exists car_bookings_one_active_per_vehicle
  on public.car_bookings (vehicle_id)
  where status = 'active';

comment on index public.car_bookings_one_active_per_vehicle is
  '一輛車同時只能有一筆 status=''active'' 的預約。前端 startUse() 也擋，但這一層才是繞不過的（見 admin v2.37/v2.38）。';
