-- Calendar events table (migrated from Firebase cal_group/cal_taiwan/cal_china/cal_vietnam)
CREATE TABLE IF NOT EXISTS cal_events (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  category   TEXT NOT NULL,
  title      TEXT,
  "dateFrom" TEXT,
  "dateTo"   TEXT,
  notes      TEXT,
  creator    TEXT,
  "createdAt" BIGINT,
  "updatedAt" BIGINT
);
ALTER PUBLICATION supabase_realtime ADD TABLE cal_events;
