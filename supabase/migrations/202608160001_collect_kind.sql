-- ═══════════════════════════════════════════════════════════════
-- 意見徵集 collect：premortem_* 三表的第三種會議類型
-- ═══════════════════════════════════════════════════════════════
-- 事前驗屍(premortem)／腦力激盪(brainstorm)／意見徵集(collect) 共用同一套程式與同一組資料表，
-- 以 premortem_sessions.kind 區分。前兩者的行為旗標寫死在前端 PM_KINDS（那是方法論承諾，
-- 不開放主席更動）；collect 則由主席建會時決定，故需要 session 級的欄位存放那些設定。
--
-- 🔴 opt_* 一律可為 NULL：NULL ＝「照 PM_KINDS 的預設走」。
--    這樣既有的 premortem／brainstorm 資料完全不必回填，讀取端 (pmOpt) 也只有一條分支。

ALTER TABLE premortem_sessions
  -- 範本代號（gratitude / retro / general）：決定填寫欄位結構與預設文案，建會後不再變動
  ADD COLUMN IF NOT EXISTS template          TEXT,
  -- 主席建會時決定的四個行為旗標（NULL = 依 PM_KINDS 預設）
  ADD COLUMN IF NOT EXISTS opt_anonymous     BOOLEAN,
  ADD COLUMN IF NOT EXISTS opt_live_visible  BOOLEAN,
  ADD COLUMN IF NOT EXISTS opt_vote          BOOLEAN,
  -- 每人可送出的則數上限；NULL 或 0 = 不限
  ADD COLUMN IF NOT EXISTS opt_entry_cap     INTEGER,
  -- 展示階段的播放模式：主席按「下一則」時寫入索引，其他人靠輪詢同步跳到同一則。
  -- NULL / -1 = 未播放（顯示清單）
  ADD COLUMN IF NOT EXISTS play_idx          INTEGER;

-- 感恩範本的「對象」欄位。從員工清單挑選時存 target_emp_id＋target_name；
-- 自由文字（外部客戶、廠商、整個團隊）時 target_emp_id 為 NULL、只存 target_name。
-- target_a/target_b 是雙語版本：挑員工時直接沿用姓名不翻譯，自由文字才送去翻。
ALTER TABLE premortem_entries
  ADD COLUMN IF NOT EXISTS target_emp_id     TEXT,
  ADD COLUMN IF NOT EXISTS target_name       TEXT,
  ADD COLUMN IF NOT EXISTS target_a          TEXT,
  ADD COLUMN IF NOT EXISTS target_b          TEXT;

-- 清單頁以 kind + updated_at 撈，補一個複合索引（三種類型共表後資料量會長得比較快）
CREATE INDEX IF NOT EXISTS premortem_sessions_kind_updated_idx
  ON premortem_sessions (kind, updated_at DESC);
