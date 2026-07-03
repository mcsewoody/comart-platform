-- ============================================================
-- Platform Tables (Firebase → Supabase migration)
-- Run in Supabase SQL Editor AFTER 001_quotation_tables.sql
-- ============================================================

-- 公佈欄
CREATE TABLE IF NOT EXISTS portal_bulletin (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  body        TEXT,
  pinned      INT DEFAULT 0,
  authorId    TEXT,
  authorName  TEXT,
  ts          BIGINT,
  likes       JSONB DEFAULT '[]'
);

-- 即時訊息（員工留言板）
CREATE TABLE IF NOT EXISTS portal_messages (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  targetEmpId   TEXT,
  authorId      TEXT,
  authorName    TEXT,
  body          TEXT,
  ts            BIGINT,
  likes         JSONB DEFAULT '[]',
  parentId      TEXT
);

-- 部門設定
CREATE TABLE IF NOT EXISTS departments (
  id   TEXT PRIMARY KEY,
  key  TEXT,
  zh   TEXT,
  en   TEXT
);

-- 據點設定
CREATE TABLE IF NOT EXISTS sites (
  id   TEXT PRIMARY KEY,
  key  TEXT,
  zh   TEXT,
  en   TEXT
);

-- 差旅
CREATE TABLE IF NOT EXISTS trips (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  empId       TEXT,
  dateFrom    TEXT,
  dateTo      TEXT,
  dest        TEXT,
  flight      TEXT,
  notes       TEXT,
  out         JSONB DEFAULT '{}',
  ret         JSONB DEFAULT '{}',
  createdAt   BIGINT,
  updatedAt   BIGINT
);

-- ── Realtime ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE portal_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE portal_bulletin;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
