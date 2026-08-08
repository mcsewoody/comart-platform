-- 030_premortem_summary_edit.sql
-- 事前驗屍：定稿後主席可編輯「AI 評論與總結」。
-- 記錄修訂軌跡，讓存檔的會議結論看得出來是純 AI 產出、還是經主席人工修訂過
-- （AI 產出的正式紀錄若無法分辨是否被改過，日後追溯會失去意義）。
-- summary_edited_at / summary_edited_by：最後一次人工修訂的時間與人
-- 重新生成（pmGenSummary）會把這兩欄清成 null，因為那是全新的 AI 產出

alter table public.premortem_sessions
  add column if not exists summary_edited_at timestamptz,
  add column if not exists summary_edited_by text;
