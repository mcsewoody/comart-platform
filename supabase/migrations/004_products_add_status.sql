-- Add status column to products table
-- Products have a lifecycle status feature (e.g. 'Normal', 'EOL', 'NPI')
-- that is managed via quotation_settings.statuses
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Normal';
