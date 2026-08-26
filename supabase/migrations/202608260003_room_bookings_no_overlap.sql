-- 會議室：同一間房、同一時段不可重複預約（2026-08-26）
--
-- 前端 bkConfirm()／iBkConfirm() 已經有時段衝突檢查，但它比對的是**瀏覽器快取**，
-- 而快取可能是幾秒前的：兩個人同時在挑同一個時段，兩邊的檢查都會通過。
-- 那個競態只有資料庫擋得住。
--
-- 為什麼是 exclusion constraint 而不是 unique index：公務車是「一輛車只能有一筆
-- 使用中」＝等值重複，unique 就夠；會議室是「時段重疊」，需要 && 運算子，
-- 只有 EXCLUDE USING gist 做得到。room_id 的 = 比較需要 btree_gist。
create extension if not exists btree_gist;

-- 🔴 約束會套用到全部歷史資料。有既存重疊時建不起來，而原生錯誤只會說
--    「could not create exclusion constraint」看不出是哪一間房、哪一天，
--    所以先自己查出來列清楚（同 migration 202608260002 的做法）。
do $$
declare
  r    record;
  msg  text := '';
  n    int  := 0;
begin
  for r in
    select coalesce(mr.name, '(未知)') || ' [' || a.room_id || ']' as room,
           a.book_date,
           a.start_time as as_, a.end_time as ae, coalesce(nullif(a.title,''), '(無標題)') as ta,
           b.start_time as bs,  b.end_time as be, coalesce(nullif(b.title,''), '(無標題)') as tb
      from public.room_bookings a
      join public.room_bookings b
        on  a.room_id   = b.room_id
        and a.book_date = b.book_date
        and a.id < b.id                             -- 每組只列一次
      left join public.meeting_rooms mr on mr.id = a.room_id
     where coalesce(a.status,'confirmed') <> 'cancelled'
       and coalesce(b.status,'confirmed') <> 'cancelled'
       and a.end_time > a.start_time                -- 跨夜／壞資料不納入（下面的 WHERE 也排除）
       and b.end_time > b.start_time
       and a.start_time < b.end_time                -- 重疊；端點相接（10-11 與 11-12）不算
       and a.end_time   > b.start_time
     order by a.book_date desc, a.room_id
     limit 40
  loop
    n := n + 1;
    msg := msg || format(E'\n  %s  %s  %s–%s「%s」  ↔  %s–%s「%s」',
                         r.room, r.book_date, r.as_, r.ae, r.ta, r.bs, r.be, r.tb);
  end loop;
  if n > 0 then
    raise exception E'room_bookings 已有 % 組重疊預約，約束無法建立。\n請先到 admin →會議室→預約記錄，把每一組其中一筆取消（歷史紀錄請自行判斷該保留哪一筆），再重新執行本 migration。\n%', n, msg;
  end if;
end $$;

-- book_date(date) + start_time(time) → timestamp，兩個運算都是 immutable，可以進索引。
-- 邊界用 '[)'：結束時間等於下一場的開始時間**不算衝突**（10:00–11:00 與 11:00–12:00 可以並存），
-- 與前端 timeToMin(a.start) < timeToMin(b.end) && timeToMin(a.end) > timeToMin(b.start) 的判斷一致。
-- 🔴 兩邊的邊界語意必須一樣，否則會出現「前端說可以、資料庫說不行」的死路。
alter table public.room_bookings
  add constraint room_bookings_no_overlap
  exclude using gist (
    room_id with =,
    tsrange(book_date + start_time, book_date + end_time, '[)') with &&
  )
  where (coalesce(status,'confirmed') <> 'cancelled' and end_time > start_time);

comment on constraint room_bookings_no_overlap on public.room_bookings is
  '同一間會議室不可有時段重疊的未取消預約。前端也擋，但前端比對的是快取，擋不住兩人同時送出的競態（見 admin v2.39）。';
