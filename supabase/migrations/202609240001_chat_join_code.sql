-- 線上對話：每一場一組「邀請連結」用的通行碼（Portal v2.04，2026-09-24）
--
-- 🔴 為什麼不是「知道場次 id 就進得去」：
--    admin 在清單上看得到**每一場**的 id（他要能判斷哪一場該刪），
--    但 CLAUDE.md 明訂 admin 讀不到別人的對話內容。
--    若自助加入只憑 id，admin 只要把 id 貼進網址就能把自己加進任何一場 ——
--    那條規則等於作廢。所以連結帶一段只有發起人拿得到的 join_code，
--    **「拿到連結」與「看得到 id」才是兩件事**。
--
-- sb-proxy 的責任（已同步修改）：
--   ① GET／PATCH 的回應裡，非發起人的列一律剝掉 join_code
--   ② PATCH 只帶 {join_code} ＝ 持通行證加入，由伺服器自己把簽章身分併進 members
--   ③ 已結束的場次不接受加入（存檔不該事後混進人）
--
-- 還原：alter table public.chat_sessions drop column join_code;

alter table public.chat_sessions
  add column if not exists join_code text;

-- 既有場次補一組，否則舊對話按「邀請連結」會產生一條進不去的網址
update public.chat_sessions
   set join_code = replace(gen_random_uuid()::text, '-', '')
 where join_code is null;

-- 新場次由資料庫給預設值：前端忘了帶也不會出現「沒有通行碼」的場次
alter table public.chat_sessions
  alter column join_code set default replace(gen_random_uuid()::text, '-', '');

alter table public.chat_sessions
  alter column join_code set not null;
