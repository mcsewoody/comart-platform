-- 202608080023_poll_images_bucket.sql
-- 投票系統的圖片(背景/選項配圖)用的公開 Storage bucket。
-- 公開讀取(顯示 <img>)；寫入經 sb-proxy(service_role)轉發。
insert into storage.buckets (id, name, public)
values ('poll-images', 'poll-images', true)
on conflict (id) do nothing;
