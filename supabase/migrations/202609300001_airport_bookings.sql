-- 機場接送預約：從 Google Apps Script + Google Sheet 搬進 Supabase。
--
-- 原系統（comart-car-booking.web.app）的後端是一支 Apps Script 網頁應用程式，
-- 網址直接寫在網頁原始碼第 428 行，而且**整份程式碼沒有任何一處驗身分** ——
-- 實測不必登入就能呼叫任意函式（用不存在的預約編號打 cancelBooking，
-- 回的是應用層的「找不到預約」而不是 401）。也就是任何人看一次原始碼，
-- 就讀得到每一筆預約的申請人姓名、工號、手機、**住家地址**、乘客資料與航班。
--
-- 另外 script.google.com 是 Google 網域、**在中國被 GFW 封鎖**，
-- 所以東莞廠的同事本來就用不了（同產品圖放 Firebase 的那個坑）。
--
-- 🔴 欄位名是表單 name 的機械轉換（outPickupDate → out_pickup_date），
--    前端用一個 snake/camel 函式雙向對映，**不要手寫對照表** ——
--    50 個欄位的手寫對照表必然會漏，而漏掉的症狀是「那一格永遠是空的」。

begin;

create table if not exists public.airport_bookings (
  id text primary key,                       -- AP20260930-001
  -- 🔴 申請人身分以 session 為準，由 sb-proxy 強制寫入，不信前端送來的值。
  --    原系統的申請人是打字打出來的，等於誰都能用別人的名義預約。
  emp_id text not null,

  applicant text not null,
  dept text,
  emp_no text,
  mobile text not null,
  ext text,
  email text,
  purpose text,
  trip_no text,

  service_type text not null,                -- 送機／接機／來回
  car_type text not null,                    -- 4人座／7人座
  pax_count integer,
  signboard boolean not null default false,

  lug20 integer not null default 0,
  lug25 integer not null default 0,
  lug27 integer not null default 0,
  lug29 integer not null default 0,
  lug_other text,

  p1_name text, p1_mobile text, p1_email text, p1_note text,
  p2_name text, p2_mobile text, p2_email text, p2_note text,

  -- 去程（送機）
  out_flight text, out_airport text, out_terminal text,
  out_date date, out_dep_time text, out_dest text,
  out_pickup_date date, out_pickup_time text,
  out_city text, out_dist text, out_addr text,

  -- 回程（接機）
  in_flight text, in_airport text, in_terminal text,
  in_date date, in_arr_time text, in_origin text,
  in_pickup_date date, in_pickup_time text,
  in_city text, in_dist text, in_addr text,
  in_delay integer,

  -- 中途停靠
  stop_leg text, stop_city text, stop_dist text, stop_addr text,

  note text,

  status text not null default '已預約'
    check (status in ('已預約', '已取消', '已完成')),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by text,

  -- 「寄給廠商」是人按的，按了才記；沒有這個時間戳就代表還沒通知廠商
  sent_to_vendor_at timestamptz,
  sent_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 🔴 RLS 開著、零 policy：前端一律經 sb-proxy（service_role 繞過 RLS），
--    所以這等於「除了 sb-proxy 沒有別條路」。漏掉這行的話，
--    印在每一頁原始碼裡的 anon key 就讀得到整張表 —— 那正是這次要修掉的東西。
alter table public.airport_bookings enable row level security;

-- 清單預設依建立時間反序；「我的預約」是最常見的查詢
create index if not exists airport_bookings_emp_created_idx
  on public.airport_bookings (emp_id, created_at desc);
create index if not exists airport_bookings_created_idx
  on public.airport_bookings (created_at desc);
-- 行政要看「即將出車」，用上車日期找
create index if not exists airport_bookings_out_pickup_idx
  on public.airport_bookings (out_pickup_date) where status = '已預約';
create index if not exists airport_bookings_in_pickup_idx
  on public.airport_bookings (in_pickup_date) where status = '已預約';

create or replace function public.airport_bookings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists airport_bookings_set_updated on public.airport_bookings;
create trigger airport_bookings_set_updated
  before update on public.airport_bookings
  for each row execute function public.airport_bookings_touch();

/* 預約編號 AP{yyyymmdd}-{3 碼流水}，沿用原系統的格式（單據上、跟廠商溝通時
   都用這個編號）。🔴 流水號在 DB 算，不在前端 —— 原系統是
   `a.filter(x => x.id.startsWith(prefix)).length + 1`，兩個人同時送出會拿到
   同一個編號。這裡用 advisory lock 把同一天的號碼序列化。 */
create or replace function public.airport_next_booking_id()
returns text language plpgsql security definer set search_path = public as $$
declare
  ymd text := to_char((now() at time zone 'Asia/Taipei'), 'YYYYMMDD');
  prefix text;
  n integer;
begin
  prefix := 'AP' || ymd || '-';
  -- 同一天共用一把鎖；不同天互不阻塞
  perform pg_advisory_xact_lock(hashtext('airport_booking_' || ymd));
  select coalesce(max(substring(id from '\d+$')::integer), 0) + 1
    into n from public.airport_bookings where id like prefix || '%';
  return prefix || lpad(n::text, 3, '0');
end;
$$;

revoke all on function public.airport_next_booking_id() from public, anon, authenticated;
grant execute on function public.airport_next_booking_id() to service_role;

commit;
