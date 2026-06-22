-- Fix products table schema:
-- 1. name/features were TEXT but store multilingual JSON objects → change to JSONB
-- 2. Add missing columns that were silently skipped during Firebase migration

-- Convert name and features TEXT → JSONB
-- (existing data stored as JSON string e.g. '{"en":"foo"}' converts cleanly)
ALTER TABLE products
  ALTER COLUMN name     TYPE JSONB USING CASE WHEN name     IS NULL OR name     = '' THEN NULL ELSE name::jsonb     END,
  ALTER COLUMN features TYPE JSONB USING CASE WHEN features IS NULL OR features = '' THEN NULL ELSE features::jsonb END;

-- Add missing columns
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS img2      TEXT,
  ADD COLUMN IF NOT EXISTS img3      TEXT,
  ADD COLUMN IF NOT EXISTS compat    JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS bom       JSONB,
  ADD COLUMN IF NOT EXISTS "costRef" TEXT;
