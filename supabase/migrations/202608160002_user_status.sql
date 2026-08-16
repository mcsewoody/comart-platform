-- ═══════════════════════════════════════════════════════════════
-- users.status：在職 / 停用 / 離職（取代「把 inactive 塞進 role 欄位」的舊做法）
-- ═══════════════════════════════════════════════════════════════
-- 舊做法把「停用」寫進 role 欄位（role='inactive'），代價是一停用就永遠失去
-- 「這個人本來是 admin 還是 user」——復職時救不回來。而且布林的 active 只有兩種值，
-- 表達不了「停用」與「離職」的差別（前者是帳號被關掉，後者是人已經離開公司）。
--
-- 🔴 關鍵設計：status 是新的事實來源，但 active 布林**保留並自動同步**。
--    五個系統約 30 處人員查詢都寫著 `active=eq.true`，只要 active 跟著 status 走，
--    那些查詢一行都不用改，離職者就自動從所有會議／投票／抽籤／通訊錄的選單消失。
--    同步交給 trigger 而不是前端：任何一條沒改到的寫入路徑都不會讓兩個欄位不一致。

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status      TEXT,
  ADD COLUMN IF NOT EXISTS resigned_at DATE;

-- 既有資料回填：目前 33 筆全部在職、0 筆停用，但仍照舊值推導以防萬一
UPDATE users
   SET status = CASE
                  WHEN active IS FALSE OR role = 'inactive' THEN 'disabled'
                  ELSE 'active'
                END
 WHERE status IS NULL;

-- 舊資料若把 inactive 塞在 role 欄位，改回一般角色（原角色已不可考，統一給 user）
UPDATE users SET role = 'user' WHERE role = 'inactive';

ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE users ALTER COLUMN status SET NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_chk;
ALTER TABLE users ADD CONSTRAINT users_status_chk
  CHECK (status IN ('active', 'disabled', 'resigned'));

-- ── status 與 active 的雙向同步 ──
-- status 是主、active 是從；但舊程式若只改 active（沒送 status），也要能推回 status，
-- 否則那條路徑會被 trigger 直接還原、看起來像「停用按了沒反應」。
CREATE OR REPLACE FUNCTION users_sync_status_active() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL THEN
      NEW.status := CASE WHEN NEW.active IS FALSE THEN 'disabled' ELSE 'active' END;
    END IF;
    NEW.active := (NEW.status = 'active');
  ELSE
    -- 兩個都改時 status 說了算（它才是事實來源）
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.active := (NEW.status = 'active');
    ELSIF NEW.active IS DISTINCT FROM OLD.active THEN
      NEW.status := CASE WHEN NEW.active THEN 'active' ELSE 'disabled' END;
    END IF;
  END IF;
  -- 離職日期只有在離職狀態下有意義：復職時一併清掉，免得留下矛盾的紀錄
  IF NEW.status <> 'resigned' THEN NEW.resigned_at := NULL; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_sync_status_active_trg ON users;
CREATE TRIGGER users_sync_status_active_trg
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_sync_status_active();

-- 用戶管理清單會依狀態分組顯示
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
