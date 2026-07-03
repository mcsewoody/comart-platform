-- Add 'suspended' to car_vehicles status column
-- Drop existing constraint if any, then recreate with suspended included
DO $$
BEGIN
  -- Remove any existing CHECK constraint on status
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%car_vehicles%status%'
       OR constraint_name LIKE '%status%'
       AND constraint_name IN (
         SELECT constraint_name FROM information_schema.table_constraints
         WHERE table_name = 'car_vehicles' AND constraint_type = 'CHECK'
       )
  ) THEN
    ALTER TABLE car_vehicles DROP CONSTRAINT IF EXISTS car_vehicles_status_check;
  END IF;
END $$;

-- Ensure status column accepts 'suspended'
ALTER TABLE car_vehicles
  ALTER COLUMN status SET DEFAULT 'available',
  ADD CONSTRAINT car_vehicles_status_check
    CHECK (status IN ('available','in_use','maintenance','suspended','retired'));
