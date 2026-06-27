-- ============================================================
-- Admin System: add site column to car_vehicles and lib_books
-- Run in Supabase SQL Editor
-- ============================================================

-- 公務車：加入 site 欄位
ALTER TABLE car_vehicles
  ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT 'TW';

-- 圖書館書目：加入 site 欄位
ALTER TABLE lib_books
  ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT 'TW';

-- 選擇性 index
CREATE INDEX IF NOT EXISTS idx_car_vehicles_site ON car_vehicles(site);
CREATE INDEX IF NOT EXISTS idx_lib_books_site ON lib_books(site);
