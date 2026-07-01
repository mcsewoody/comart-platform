-- Add site column to car_parkings so parking spaces are isolated per site
ALTER TABLE car_parkings
  ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT 'TW';

CREATE INDEX IF NOT EXISTS idx_car_parkings_site ON car_parkings(site);
