-- Add fuel level column to car_vehicles (0-7 scale: E/1/8/1/4/3/8/1/2/5/8/3/4/F)
ALTER TABLE car_vehicles ADD COLUMN IF NOT EXISTS fuel_lvl INTEGER DEFAULT 4;
