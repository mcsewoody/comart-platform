-- Meeting rooms: move from hardcoded constant to Supabase table
CREATE TABLE IF NOT EXISTS meeting_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT 'TW',
  cap INTEGER DEFAULT 0,
  equip JSONB DEFAULT '[]',
  icon TEXT DEFAULT '🏠',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_rooms_site ON meeting_rooms(site);

-- Seed with current hardcoded rooms (safe to run multiple times)
INSERT INTO meeting_rooms (id, name, site, cap, equip, icon) VALUES
  ('TW-big',   '大會議室', 'TW', 20, '["視訊系統","白板","投影機"]', '🏛️'),
  ('TW-small',  '小會議室', 'TW',  8, '["視訊系統","白板","投影機"]', '🚪'),
  ('CN-big',   '大會議室', 'CN', 20, '["視訊系統","白板","投影機"]', '🏛️'),
  ('CN-small',  '小會議室', 'CN',  8, '["視訊系統","白板","投影機"]', '🚪'),
  ('VN-big',   '大會議室', 'VN', 20, '["視訊系統","白板","投影機"]', '🏛️'),
  ('VN-small',  '小會議室', 'VN',  8, '["視訊系統","白板","投影機"]', '🚪')
ON CONFLICT (id) DO NOTHING;
