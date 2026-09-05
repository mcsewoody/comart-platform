-- ═══════════════════════════════════════════════════════════════════════
-- 線上對話 Live Chat（Portal v1.80）
--
-- 目的：不同事業單位（台灣／東莞／越南）的同事各自用自己的語言打字，
--       每一則訊息即時翻成四種語言（繁中／簡中／英／越），四語同時顯示。
--
-- 「場次」模型（與 premortem_sessions 同一個形狀，刻意的）：
--   開一場對話 → 談 → 開啟者結束 → 自己決定保留或丟棄。
--   保留的日後可再讀、可輸出 PDF；不保留的整場刪掉（cascade 帶走訊息）。
--
-- 🔴 四個語言各一個欄位，而不是一張 translations 子表：
--    聊天室每 3 秒輪詢一次，join 一張子表等於把每次輪詢的成本乘上訊息數。
--    語言集合是寫死的四種（產品決策，不是資料驅動），所以攤平成欄位沒有擴充性代價。
--    來源語言那一欄存的是「原文本身，一字不動」——不是把原文再翻回自己的語言。
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists chat_sessions (
  id           text primary key,
  title        text        not null default '',
  host_emp_id  text        not null,
  host_name    text                 default '',
  -- open：進行中，任何在職同事都能進來發言
  -- ended：已結束。keep=true 才留在「已保留」清單裡；keep=false 的場次前端會直接刪掉，
  --        所以 status='ended' and keep=false 只會是「刪除中途失敗」的殘骸
  status       text        not null default 'open',
  keep         boolean     not null default false,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  -- 最後一則訊息的時間，只為了清單排序（用 max(created_at) 要掃訊息表）
  last_at      timestamptz not null default now()
);

create table if not exists chat_messages (
  id          text primary key,
  session_id  text        not null references chat_sessions(id) on delete cascade,
  emp_id      text        not null,
  author_name text                 default '',
  -- 模型自己辨識的來源語言（zh-TW／zh-CN／en／vi）。翻譯完成前是空字串。
  -- 🔴 不做「我用的語言」下拉：那是 board v1.77 已經拿掉的設計
  src_lang    text                 default '',
  text        text        not null default '',
  text_zhtw   text,
  text_zhcn   text,
  text_en     text,
  text_vi     text,
  -- 翻譯寫回的時間。null ＝ 還在翻（畫面顯示「翻譯中…」）
  tr_at       timestamptz,
  created_at  timestamptz not null default now()
);

-- 輪詢一律是「這一場、比某個時間新」，所以複合索引的順序是 (session_id, created_at)
create index if not exists chat_messages_session_time on chat_messages (session_id, created_at);
-- 清單只查 open 與 ended，各自依時間倒排
create index if not exists chat_sessions_status_last  on chat_sessions (status, last_at desc);
-- 補翻譯時要撈「這一場還沒翻完的」：部分索引比全表掃便宜，而且已翻完的不佔空間
create index if not exists chat_messages_pending_tr   on chat_messages (session_id) where tr_at is null;
