-- ============================================================
-- Fix: drop & recreate tables with quoted camelCase columns
-- PostgreSQL folds unquoted identifiers to lowercase; quoting preserves case.
-- ============================================================

-- Drop existing empty tables (safe — data migration failed, nothing to lose)
DROP TABLE IF EXISTS crm_tasks, crm_activities, crm_contacts, crm_accounts,
  logs, price_history, categories, suppliers, products, quotes,
  quotation_settings, portal_bulletin, portal_messages, departments, sites, trips CASCADE;

-- 報價單
CREATE TABLE quotes (
  id            TEXT PRIMARY KEY,
  ref           TEXT,
  date          TEXT,
  company       TEXT,
  attn          TEXT,
  email         TEXT,
  tel           TEXT,
  lang          TEXT DEFAULT 'en',
  status        TEXT DEFAULT 'draft',
  inco          TEXT,
  pay           TEXT,
  currency      TEXT DEFAULT 'USD',
  "outCurrency" TEXT DEFAULT 'USD',
  notes         TEXT,
  sales         TEXT,
  operator      TEXT,
  "moqTiers"    JSONB DEFAULT '[]',
  products      JSONB DEFAULT '[]',
  prices        JSONB DEFAULT '{}',
  featured      JSONB DEFAULT '{}',
  "accountId"   TEXT,
  "createdAt"   BIGINT,
  "createdBy"   TEXT,
  "updatedAt"   BIGINT
);

-- 產品
CREATE TABLE products (
  id             TEXT PRIMARY KEY,
  series         TEXT,
  name           TEXT,
  features       TEXT,
  "catId"        TEXT,
  "catId2"       TEXT,
  "defaultPrice" NUMERIC,
  supplier1      TEXT,
  curr1          TEXT,
  cost1          NUMERIC,
  supplier2      TEXT,
  curr2          TEXT,
  cost2          NUMERIC,
  material       TEXT,
  "interfaceA"   TEXT,
  "interfaceB"   TEXT,
  tooling        TEXT,
  coo            TEXT,
  dim            TEXT,
  weight         TEXT,
  pkgdim         TEXT,
  pkgweight      TEXT,
  remark         TEXT,
  img            TEXT,
  docs           JSONB DEFAULT '[]',
  "bomFiles"     JSONB DEFAULT '[]',
  "createdAt"    BIGINT,
  "updatedAt"    BIGINT
);

-- 系統設定（用 data JSONB 承接所有欄位，避免遺漏）
CREATE TABLE quotation_settings (
  id    TEXT PRIMARY KEY DEFAULT 'main',
  data  JSONB DEFAULT '{}'
);
INSERT INTO quotation_settings (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- 供應商
CREATE TABLE suppliers (
  id          TEXT PRIMARY KEY,
  code        TEXT,
  name        TEXT,
  country     TEXT,
  contact     TEXT,
  email       TEXT,
  phone       TEXT,
  website     TEXT,
  payment     TEXT,
  currency    TEXT,
  inco        TEXT,
  moq         TEXT,
  leadtime    TEXT,
  qcert       TEXT,
  pcert       TEXT,
  remarks     TEXT,
  "updatedAt" BIGINT
);

-- 產品分類
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  code        TEXT,
  "desc"      TEXT,
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

-- 售價歷史
CREATE TABLE price_history (
  id         TEXT PRIMARY KEY,
  "prodId"   TEXT,
  series     TEXT,
  ts         BIGINT,
  "empId"    TEXT,
  "empName"  TEXT,
  "oldPrice" NUMERIC,
  "newPrice" NUMERIC
);

-- 操作記錄
CREATE TABLE logs (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  ts         BIGINT,
  date       TEXT,
  "empId"    TEXT,
  "nameEn"   TEXT,
  action     TEXT,
  type       TEXT,
  detail     TEXT
);

-- CRM 客戶
CREATE TABLE crm_accounts (
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
  "createdAt" BIGINT,
  "createdBy" TEXT,
  "updatedAt" BIGINT
);

-- CRM 聯絡人
CREATE TABLE crm_contacts (
  id          TEXT PRIMARY KEY,
  "accountId" TEXT,
  name        TEXT,
  title       TEXT,
  role        TEXT,
  email       TEXT,
  phone       TEXT,
  linkedin    TEXT,
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

-- CRM 活動記錄
CREATE TABLE crm_activities (
  id          TEXT PRIMARY KEY,
  "accountId" TEXT,
  title       TEXT,
  date        TEXT,
  type        TEXT,
  detail      TEXT,
  followup    TEXT,
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

-- CRM 任務
CREATE TABLE crm_tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  due         TEXT,
  priority    TEXT DEFAULT 'medium',
  "accountId" TEXT,
  notes       TEXT,
  done        BOOLEAN DEFAULT FALSE,
  "createdAt" BIGINT,
  "createdBy" TEXT,
  "updatedAt" BIGINT
);

-- 公佈欄
CREATE TABLE portal_bulletin (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  body         TEXT,
  pinned       INT DEFAULT 0,
  "authorId"   TEXT,
  "authorName" TEXT,
  ts           BIGINT,
  likes        JSONB DEFAULT '[]'
);

-- 即時訊息
CREATE TABLE portal_messages (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "targetEmpId"  TEXT,
  "authorId"     TEXT,
  "authorName"   TEXT,
  body           TEXT,
  ts             BIGINT,
  likes          JSONB DEFAULT '[]',
  "parentId"     TEXT
);

-- 部門設定
CREATE TABLE departments (
  id  TEXT PRIMARY KEY,
  key TEXT,
  zh  TEXT,
  en  TEXT
);

-- 據點設定
CREATE TABLE sites (
  id  TEXT PRIMARY KEY,
  key TEXT,
  zh  TEXT,
  en  TEXT
);

-- 差旅
CREATE TABLE trips (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "empId"     TEXT,
  "dateFrom"  TEXT,
  "dateTo"    TEXT,
  dest        TEXT,
  flight      TEXT,
  notes       TEXT,
  out         JSONB DEFAULT '{}',
  ret         JSONB DEFAULT '{}',
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE quotes;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE price_history;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_activities;
ALTER PUBLICATION supabase_realtime ADD TABLE crm_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE portal_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE portal_bulletin;
