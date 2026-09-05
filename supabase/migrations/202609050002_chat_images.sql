-- ═══════════════════════════════════════════════════════════════════════
-- 線上對話：圖片附件（Portal v1.82）
--
-- 🔴 bucket 設為 **private**，與 board 的 poll-images（公開）刻意不同。
--    投票圖片是「選項的示意圖」，內容可預期；線上對話裡貼的是什麼無法預期
--    （實務上多半是訂單、報價、BOM 的截圖），而公開 bucket 的網址一旦被轉發出去
--    就永久有效、不需登入。與成本檔案（product-private）採同一個判斷。
--    代價：<img src> 不能直接吃，要先向 sb-proxy 換一次簽章網址。
--
-- 這個 bucket **刻意不加入 sb-proxy 的 RESTRICTED_BUCKETS**：
--    那份清單會把存取限縮到 admin／dcc，而對話圖片必須全體同事都看得到。
--    不在清單上 ＝ 任何持有有效 session 的人都能經 sb-proxy 取用，正是要的權限。
-- ═══════════════════════════════════════════════════════════════════════

alter table chat_messages add column if not exists img_path text;   -- storage 物件鍵（純 ASCII）
alter table chat_messages add column if not exists img_name text;   -- 原始檔名，只用於顯示與下載
alter table chat_messages add column if not exists img_mime text;
-- 寬高存下來是為了在圖片載入前就把版面空間留好：聊天室會自動捲到底，
-- 圖片載入後才撐開高度會讓正在讀的人畫面跳動
alter table chat_messages add column if not exists img_w int;
alter table chat_messages add column if not exists img_h int;

-- text 原本是 not null default ''：只貼圖不打字的訊息 text 就是空字串，
-- 這是合法狀態（渲染時不顯示譯文區塊、也不送翻譯），不需要改約束。

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-images', 'chat-images', false, 10485760)
on conflict (id) do nothing;
