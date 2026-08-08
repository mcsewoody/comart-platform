-- 031_premortem_meeting_info.sql
-- 事前驗屍：建會時登錄會議基本資訊，供日後查閱與匯出。
-- meet_at        會議日期／時間。**存 text（'YYYY-MM-DD HH:mm' 當地時間）而非 timestamptz**：
--                這是主席手填的當地時間，存 text 就不會有 UTC 換算導致顯示差 8 小時的問題；
--                此格式字典序等同時間序，排序照樣正確。
-- meet_location  會議地點（手動輸入）
-- attendees      與會人員（手動輸入，自由文字；與 scope_members 的「開放權限範圍」是兩件事）

alter table public.premortem_sessions
  add column if not exists meet_at       text,
  add column if not exists meet_location text,
  add column if not exists attendees     text;
