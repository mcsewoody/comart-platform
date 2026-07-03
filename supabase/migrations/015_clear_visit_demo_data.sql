-- Remove all visit demo data seeded by seedVisitDemo()
DO $$ BEGIN
  DELETE FROM visit_records;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DELETE FROM visit_guests;
EXCEPTION WHEN undefined_table THEN NULL; END $$;
