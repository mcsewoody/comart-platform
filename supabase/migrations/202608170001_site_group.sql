-- ═══════════════════════════════════════════════════════════════
-- 地點新增「集團 GRP」：取代語意不明的 'N/A'
-- ═══════════════════════════════════════════════════════════════
-- 'N/A' 原本的意思是「不適用 / 沒有指定地點」，但實際用途是「隸屬集團、不屬於單一營運中心」。
-- 這兩者的行為正好相反：'N/A' 讀起來像「不屬於任何中心」，集團卻是「屬於每一個中心」——
-- 集團成員要參與每個營運中心的工作（投票、抽籤、留言、週會、公告）。
-- 鍵值留著 'N/A' 會是永久的陷阱，故改成 'GRP'。
--
-- 影響範圍已查證：'N/A' 只出現在 users(3) 與 kms_users(3)，
-- 其他 9 張帶 site／scope_site 的表都是 0 筆，所以改鍵值是安全的。
-- 🔴 前端仍保留相容判斷（isGroupSite 同時認 'GRP' 與 'N/A'）：
--    那 3 位使用者瀏覽器裡的 session 快取還帶著舊值，要等他們重新登入才會更新。

INSERT INTO sites (id, key, zh, en) VALUES ('GRP', 'GRP', '集團', 'Group')
ON CONFLICT (id) DO UPDATE SET key = 'GRP', zh = '集團', en = 'Group';

UPDATE users      SET site = 'GRP' WHERE site = 'N/A';
UPDATE kms_users  SET site = 'GRP' WHERE site = 'N/A';
