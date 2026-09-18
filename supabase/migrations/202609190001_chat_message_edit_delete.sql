-- ═══════════════════════════════════════════════════════════════════════
-- 線上對話：訊息可修改、可刪除，兩者都留下痕跡（Portal v2.01）
--
-- 使用者 2026-09-19 指定的三件事：
--   ① 發起人可刪除任何一則（含別人的），留下「本訊息已刪除！」
--   ② 本人可刪除自己的，一樣留下那句話
--   ③ 對話進行中可修改已送出的訊息，留下「訊息已修改！」
--
-- 🔴 刪除是**軟刪除 ＋ 真的抹掉內容**，不是只加一個旗標。
--    只加旗標的話，內容還在資料庫裡 —— 而「前端不顯示」擋不住直接打 sb-proxy 的人
--    （CLAUDE.md 記過兩次的同一個坑：「經過代理才驗的守衛，前提是沒有別條路」）。
--    所以刪除會把 text／四語譯文／src_lang／img_* 全部清空，只留 deleted_at＋deleted_by。
--    代價：**刪掉就真的沒有了，不留稽核內容**。這是聊天室該有的語意
--    （不同於 premortem 的 ai_summary 有 premortem_summary_log 保存舊版 ——
--    那是正式會議紀錄，這是談話）。要追究「誰刪的」看 deleted_by。
--
-- 🔴 修改**不保存舊版**，只記 edited_at。痕跡的作用是讓讀的人知道
--    「這句話後來被動過」，那是揭露，不是稽核。board 的事前驗屍在 reveal 之後
--    禁止修改（怕偷偷換掉別人看過的內容），聊天室改用「公開標記」處理同一個風險。
-- ═══════════════════════════════════════════════════════════════════════

alter table chat_messages add column if not exists edited_at  timestamptz;
alter table chat_messages add column if not exists deleted_at timestamptz;
alter table chat_messages add column if not exists deleted_by text;          -- 工號

-- 🔴 updated_at 是這次功能成立的前提，不是附帶的欄位。
--    原本的輪詢只抓「created_at 比最後一則新」的訊息，所以**別人改字或刪訊息，
--    其他人的畫面永遠不會更新** —— 修改與刪除等於只有自己看得到。
--    有了 updated_at，一個「這一場、比上次同步新」的查詢就同時涵蓋
--    新訊息＋改過的＋刪掉的＋剛翻好的，還比舊版少一個查詢（併發上限的坑）。
alter table chat_messages add column if not exists updated_at timestamptz not null default now();

create or replace function chat_messages_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists chat_messages_set_updated on chat_messages;
create trigger chat_messages_set_updated
  before update on chat_messages
  for each row execute function chat_messages_touch();

-- 輪詢用：(session_id, updated_at) 與既有的 (session_id, created_at) 對稱
create index if not exists chat_messages_session_updated on chat_messages (session_id, updated_at);

-- RLS：chat_messages 早就是「開著 ＋ 零 policy」＝ anon／authenticated 全拒，
-- 存取一律經 sb-proxy 的 service_role。這次不新增任何 policy（新欄位自動同樣受保護）。

-- ── 還原（如果要退回 v2.00）──────────────────────────────────────────
--   drop trigger if exists chat_messages_set_updated on chat_messages;
--   drop function if exists chat_messages_touch();
--   drop index  if exists chat_messages_session_updated;
--   alter table chat_messages drop column if exists updated_at;
--   alter table chat_messages drop column if exists deleted_by;
--   alter table chat_messages drop column if exists deleted_at;
--   alter table chat_messages drop column if exists edited_at;
--   ⚠️ 已經被刪除的訊息內容不會因為還原而回來（那些資料當時就抹掉了）。
