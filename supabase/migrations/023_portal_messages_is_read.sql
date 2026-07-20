-- 名人榜／通訊錄留言板目前沒有已讀狀態：對方是否看過、有沒有回覆都無從得知，
-- 通訊錄卡片上的留言數也只是總數，看不出「有沒有新留言」。
-- 加上 is_read，讓通訊錄卡片能標示未讀提示（2026-07-21）。
ALTER TABLE public.portal_messages
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;

-- 既有留言一律視為已讀，避免上線當下所有人被一堆舊留言的「未讀」提示洗版；
-- 之後才寫入的新留言才會走 DEFAULT false 的未讀狀態
UPDATE public.portal_messages SET is_read = true;
