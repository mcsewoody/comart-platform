-- mail-send 改成只建草稿（2026-10-09 Woody：「信件放在草稿，不要直接寄出」）。
-- draft=true 表示這一列是「在寄件人 Outlook 草稿匣建立了一封」，不是寄出；之前的列（false）是真的寄出過的。
-- 還原：alter table public.crm_mail_log drop column draft;
alter table public.crm_mail_log add column if not exists draft boolean not null default false;
