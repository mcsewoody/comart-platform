-- 202608080021_notifications_lock_anon.sql
--
-- 收斂 notifications 表的存取：先前有兩條大開的 anon 政策
--   [INSERT] allow_anon_insert_notifications (CHECK=true)  → 任何 anon 可塞任意通知(可偽造/釣魚/洗版)
--   [SELECT] "anon read all"                (USING=true)   → 任何 anon 可讀全部通知(含個人留言內文外洩)
-- 全站其餘寫入/讀取都已走 sb-proxy(service_role)+x-session；唯一 anon 直寫的
-- KMS sendKmsNotification 已於 KMS v2.34 改走 sb-proxy。故移除這兩條 anon 政策，
-- 只保留 service_role 全權(policy "service all")。RLS 早已啟用。

drop policy if exists allow_anon_insert_notifications on public.notifications;
drop policy if exists "anon read all" on public.notifications;
