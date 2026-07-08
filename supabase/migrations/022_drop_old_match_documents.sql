-- CREATE OR REPLACE 未能取代舊版 match_documents（PostgreSQL 認定新增了
-- 兩個尾端參數就是不同的函式簽名），造成 5 參數版與 7 參數版同時存在，
-- PostgREST 呼叫時出現多載歧義（PGRST203）。明確移除舊版，只留新版。
DROP FUNCTION IF EXISTS public.match_documents(vector, double precision, integer, text, text);
