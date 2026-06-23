-- Add conf_level column to kms_documents
-- 1 = Public (everyone), 2 = Internal (DCC + Admin), 3 = Confidential (Admin only)
ALTER TABLE kms_documents
  ADD COLUMN IF NOT EXISTS conf_level integer NOT NULL DEFAULT 1
    CHECK (conf_level BETWEEN 1 AND 3);

CREATE INDEX IF NOT EXISTS kms_documents_conf_level_idx ON kms_documents (conf_level);
