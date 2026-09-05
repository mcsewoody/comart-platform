-- ═══════════════════════════════════════════════════════════════════════
-- 線上對話：參與人清單（Portal v1.85）
--
-- 原本是「單一全公司大廳」——任何在職同事都能進任何一場（2026-09-05 早上的決定）。
-- 改為 **只有參與人能開啟**（使用者當日下午改的規則）。
--
-- 🔴 members 不含開啟者本人：他的身分已經在 host_emp_id 裡，
--    存兩份就會有「從 members 移除自己」這種需要處理的矛盾狀態。
--    判斷一律經 lcCanSee()／canSeeChat()，不要在各處自己比對。
--
-- 既有場次的 members 是 '{}'，也就是「只有開啟者看得到」。這是刻意的保守預設：
-- 舊資料沒有參與人資訊，猜錯的方向應該是「看不到」而不是「全公司看得到」。
-- ═══════════════════════════════════════════════════════════════════════

alter table chat_sessions add column if not exists members text[] not null default '{}';

-- 清單查詢是「members 包含我」（PostgREST 的 cs 運算子），需要 GIN 索引
create index if not exists chat_sessions_members on chat_sessions using gin (members);
