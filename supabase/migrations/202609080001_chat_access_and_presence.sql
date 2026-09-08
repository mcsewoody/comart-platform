-- 線上對話：① 公開／邀請制兩種進入方式 ② 房間內的在線名單（2026-09-08）
--
-- ① chat_sessions.access
--    'invite' = 只有開啟者與 members 進得去（v1.85 起的既有行為）
--    'all'    = 任何在職同事都進得去（2026-09-05 早上曾是唯一模式，當天下午改掉；
--               現在變成建會時的選項而不是全域政策）
--
-- 🔴 預設 'invite' 而不是 'all'：既有場次沒有這個欄位，猜錯的方向該是「看不到」
--    而不是「全公司突然讀得到別人的私下對話」。同 members 舊資料預設 '{}' 的判斷。
--
-- 🔴 access 建立後不可更改（sb-proxy 的 CHAT_IMMUTABLE）。
--    邀請制改成公開 ＝ 已經私下講過的話突然全公司可讀，那是 CLAUDE.md 早已否決的
--    「中途解匿」的同一種背信；反向（公開改邀請制）也一樣尷尬 —— 已經在裡面的人
--    會突然被踢出去，而他讀過的內容收不回來。要換就開新的一場。
alter table public.chat_sessions
  add column if not exists access text not null default 'invite';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_sessions_access_chk'
  ) then
    alter table public.chat_sessions
      add constraint chat_sessions_access_chk check (access in ('all', 'invite'));
  end if;
end $$;

comment on column public.chat_sessions.access is
  '''all'' = 全員可進入；''invite'' = 只有 host_emp_id 與 members。建立後不可更改（sb-proxy CHAT_IMMUTABLE）。';

-- ② chat_presence：誰在這個房間裡
--
-- 🔴 為什麼要一張表，不塞進 chat_sessions 的 jsonb：
--    在線狀態是**每個人各自寫自己那一列**。塞成一個 jsonb map 就會變成
--    「讀出整份 → 改一個鍵 → 寫回整份」，房裡五個人同時心跳就會互相蓋掉
--    （lost update）。一列一人、主鍵 (session_id, emp_id)，upsert 天生無衝突。
--
-- 🔴 沒有「離開」這個事件可以信任：關分頁、斷網、當掉都不會通知我們。
--    所以在線與否一律由 last_at 的新舊決定（前端 LC_ONLINE_MS），
--    不做「離開時刪掉自己那一列」—— 那條路在最常見的情況下不會執行。
create table if not exists public.chat_presence (
  session_id text        not null references public.chat_sessions(id) on delete cascade,
  emp_id     text        not null,
  name       text        not null default '',
  last_at    timestamptz not null default now(),
  primary key (session_id, emp_id)
);

-- 讀取一律是「這個房間的全部」，主鍵前綴就夠用，不另外建索引。
-- 整場被刪除時由 on delete cascade 帶走（同 chat_messages）。
alter table public.chat_presence enable row level security;
-- 刻意不建任何 policy：存取一律經 sb-proxy（service_role），
-- 而 sb-proxy 會把寫入的 emp_id 強制改成簽章裡的身分，防止有人偽造別人在線。

comment on table public.chat_presence is
  '線上對話的在線狀態，一列一人。在線與否由 last_at 的新舊決定，沒有「離開」事件。';
