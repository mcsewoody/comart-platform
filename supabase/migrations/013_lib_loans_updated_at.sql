-- lib_loans 缺少 updated_at 欄位，但資料表上有 trigger 試圖寫入它
-- 導致所有 PATCH/UPDATE 回傳 400: record "new" has no field "updated_at"
ALTER TABLE lib_loans
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 回填現有資料列
UPDATE lib_loans SET updated_at = created_at WHERE updated_at IS NULL;
