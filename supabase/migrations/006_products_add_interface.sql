-- Add interface column missing from original schema
ALTER TABLE products ADD COLUMN IF NOT EXISTS interface TEXT;
