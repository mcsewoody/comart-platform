-- 033_premortem_kind.sql
-- 腦力激盪子系統：與事前驗屍**共用同一套表與同一套程式**，只用 kind 欄位區分。
--
-- 為什麼不開第二組表（premortem_* → brainstorm_*）：
--   兩者是同一台機器換文案 —— 階段機、雙語翻譯、投票、AI 分群、AI 三段分析、四種輸出、
--   主席控制全部相同。複製的代價是每次改動都要做兩遍（光 2026-08 這一輪 premortem 就迭代
--   了 18 個版本），而且遲早會漏掉一邊；還要讓 sb-proxy 的 ALLOWED_TABLES 再多三張表。
--
-- kind 的值：
--   'premortem'  事前驗屍（Gary Klein）——全程匿名、填寫時互相看不到、每人 3 票
--   'brainstorm' 腦力激盪（Alex Osborn）——具名、填寫時即時可見（搭便車）、每人 5 票
--
-- 既有資料一律視為 premortem（default + not null，不必回填）。
-- 🔴 kind 一旦建立就不可更改（sb-proxy 的 PM_IMMUTABLE 已擋下）：一場已定稿的驗屍紀錄
--    若能被改成腦力激盪，等於竄改正式紀錄的性質。

alter table public.premortem_sessions
  add column if not exists kind text not null default 'premortem';

-- 清單一律以 (kind, updated_at desc) 查詢
create index if not exists premortem_sessions_kind_idx
  on public.premortem_sessions (kind, updated_at desc);
