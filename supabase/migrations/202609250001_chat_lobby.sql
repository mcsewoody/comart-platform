-- 聊天大廳（Portal v2.05，2026-09-25）
--
-- 「聊天大廳」＝ 一間**永遠開著、不管控人員**的公共聊天室。
--
-- 🔴 它刻意不是新的資料表，而是 chat_sessions 裡一列固定 id 的場次。
--    這樣訊息渲染、四語翻譯、3 秒輪詢、在線名單、圖片附件、PDF 匯出
--    **全部沿用群組對話既有的程式**，一行都不必複製。
--    （同 board 的 premortem／brainstorm／collect 共用一套 pm* 的判斷。）
--
-- 欄位的意義在這一列上是這樣讀的：
--   access='all'    → lcCanSee 對「進行中的公開場次」放行任何在職同事 ＝ 不管控人員
--   status='open'   → 永遠不結束。沒有人是 host，所以「結束對話」那顆鈕不會出現
--   host_emp_id=''  → **沒有主人**。lcIsHost() 對任何人都是 false，
--                     於是結束／邀請／重新開啟／刪除整場全部自動隱藏，
--                     不必為大廳寫一套「這些鈕不要畫」的例外
--   members='{}'    → 大廳不挑人
--
-- 🔴 sb-proxy 另有兩道守衛（同時上線）：
--    ① DELETE chat_sessions?id=eq.lobby 一律 403 —— 大廳被 cascade 刪掉就再也回不來
--    ② DELETE chat_messages 只放行「整間大廳」這一種（清除對話紀錄），
--       其餘場次維持既有的 403（單則訊息是軟刪除）
--
-- 還原：delete from public.chat_sessions where id = 'lobby';
--       （會 cascade 帶走大廳的訊息與 presence）

insert into public.chat_sessions (id, title, host_emp_id, host_name, access, status, keep, members)
values ('lobby', '聊天大廳', '', '', 'all', 'open', true, '{}')
on conflict (id) do nothing;
