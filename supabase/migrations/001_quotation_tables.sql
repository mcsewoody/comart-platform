-- ============================================================
-- Quotation System Tables (Firebase → Supabase migration)
-- Run in Supabase SQL Editor
-- ============================================================

-- 報價單
CREATE TABLE IF NOT EXISTS quotes (
  id           TEXT PRIMARY KEY,
  ref          TEXT,
  date         TEXT,
  company      TEXT,
  attn         TEXT,
  email        TEXT,
  tel          TEXT,
  lang         TEXT DEFAULT 'en',
  status       TEXT DEFAULT 'draft',
  inco         TEXT,
  pay          TEXT,
  currency     TEXT DEFAULT 'USD',
  outCurrency  TEXT DEFAULT 'USD',
  notes        TEXT,
  sales        TEXT,
  operator     TEXT,
  moqTiers     JSONB DEFAULT '[]',
  products     JSONB DEFAULT '[]',
  prices       JSONB DEFAULT '{}',
  featured     JSONB DEFAULT '{}',
  accountId    TEXT,
  createdAt    BIGINT,
  createdBy    TEXT,
  updatedAt    BIGINT
);

-- 產品（含 docs/bomFiles 附件陣列）
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  series       TEXT,
  name         TEXT,
  features     TEXT,
  catId        TEXT,
  catId2       TEXT,
  defaultPrice NUMERIC,
  supplier1    TEXT,
  curr1        TEXT,
  cost1        NUMERIC,
  supplier2    TEXT,
  curr2        TEXT,
  cost2        NUMERIC,
  material     TEXT,
  interfaceA   TEXT,
  interfaceB   TEXT,
  tooling      TEXT,
  coo          TEXT,
  dim          TEXT,
  weight       TEXT,
  pkgdim       TEXT,
  pkgweight    TEXT,
  remark       TEXT,
  img          TEXT,
  docs         JSONB DEFAULT '[]',
  bomFiles     JSONB DEFAULT '[]',
  createdAt    BIGINT,
  updatedAt    BIGINT
);

-- 系統設定（單筆，id 固定為 'main'）
CREATE TABLE IF NOT EXISTS quotation_settings (
  id        TEXT PRIMARY KEY DEFAULT 'main',
  lead      TEXT DEFAULT '45-60 days',
  valid     TEXT DEFAULT '30 days',
  inco      TEXT DEFAULT 'EXW',
  pay       TEXT DEFAULT 'T/T 30%+70%',
  note      TEXT,
  rateNTD   NUMERIC DEFAULT 32.5,
  rateRMB   NUMERIC DEFAULT 7.25,
  rateVND   NUMERIC DEFAULT 25000,
  rateJPY   NUMERIC DEFAULT 150,
  statuses  JSONB DEFAULT '[]'
);

INSERT INTO quotation_settings (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- 供應商
CREATE TABLE IF NOT EXISTS suppliers (
  id         TEXT PRIMARY KEY,
  code       TEXT,
  name       TEXT,
  country    TEXT,
  contact    TEXT,
  email      TEXT,
  phone      TEXT,
  website    TEXT,
  payment    TEXT,
  currency   TEXT,
  inco       TEXT,
  moq        TEXT,
  leadtime   TEXT,
  qcert      TEXT,
  pcert      TEXT,
  remarks    TEXT,
  updatedAt  BIGINT
);

-- 產品分類
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  code       TEXT,
  "desc"     TEXT,
  createdAt  BIGINT,
  updatedAt  BIGINT
);

-- 售價歷史
CREATE TABLE IF NOT EXISTS price_history (
  id        TEXT PRIMARY KEY,
  prodId    TEXT,
  series    TEXT,
  ts        BIGINT,
  empId     TEXT,
  empName   TEXT,
  oldPrice  NUMERIC,
  newPrice  NUMERIC
);

-- 操作記錄
CREATE TABLE IF NOT EXISTS logs (
  id      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  ts      BIGINT,
  date    TEXT,
  empId   TEXT,
  nameEn  TEXT,
  action  TEXT,
  type    TEXT,
  detail  TEXT
);

-- CRM 客戶
CREATE TABLE IF NOT EXISTS crm_accounts (
  id          TEXT PRIMARY KEY,
  company     TEXT,
  country     TEXT,
  industry    TEXT,
  type        TEXT,
  status      TEXT,
  source      TEXT,
  factory     TEXT,
  website     TEXT,
  owner       TEXT,
  notes       TEXT,
  createdAt   BIGINT,
  createdBy   TEXT,
  updatedAt   BIGINT
);

-- CRM 聯絡人
CREATE TABLE IF NOT EXISTS crm_contacts (
  id         TEXT PRIMARY KEY,
  accountId  TEXT,
  name       TEXT,
  title      TEXT,
  role       TEXT,
  email      TEXT,
  phone      TEXT,
  linkedin   TEXT,
  createdAt  BIGINT,
  updatedAt  BIGINT
);

-- CRM 活動記錄
CREATE TABLE IF NOT EXISTS crm_activities (
  id         TEXT PRIMARY KEY,
  accountId  TEXT,
  title      TEXT,
  date       TEXT,
  type       TEXT,
  detail     TEXT,
  followup   TEXT,
  createdAt  BIGINT,
  updatedAt  BIGINT
);

-- CRM 任務
CREATE TABLE IF NOT EXISTS crm_tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  due        TEXT,
  priority   TEXT DEFAULT 'medium',
  accountId  TEXT,
  notes      TEXT,
  done       BOOLEAN DEFAULT FALSE,
  createdAt  BIGINT,
  createdBy  TEXT,
  updatedAt  BIGINT
);

-- ── Realtime (需要開啟 postgres_changes 訂閱) ────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE quotes;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE price_history;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_activities;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_tasks;
