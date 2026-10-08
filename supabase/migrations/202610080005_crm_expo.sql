-- CRM 展覽模式（quotation v3.72，2026-10-08 Woody）
--   展覽（邀請函、跟進信的 AI 指引、感謝信範本、會場照片）＋ 來賓（哪個展、誰掃的、寄了什麼）＋ 寄信紀錄。
--   寄信一律經 edge function mail-send（Microsoft Graph，從登入者本人的公司信箱寄）。
-- 🔴 RLS 開 ＋ 零 policy ＋ revoke（前端一律經 sb-proxy）。檔案放私有 bucket crm-expo，sb-proxy 限業務部 ＋ admin。
-- 還原：drop table crm_mail_log, crm_expo_visits, crm_exhibitions; delete from storage.buckets where id='crm-expo';

create table if not exists public.crm_exhibitions (
  id            text primary key,
  name          text not null,
  venue         text,
  booth         text,
  start_date    date,
  end_date      date,
  invite_path   text,          -- crm-expo 內的邀請函（PDF／圖）
  invite_name   text,
  invite_mime   text,
  followup_guide text,         -- 給 AI 的跟進信指引（要強調的產品、攤位、語氣…）
  thanks_subject text,
  thanks_body    text,         -- 感謝信範本，{name}／{company} 佔位
  photos        jsonb not null default '[]'::jsonb,   -- [{path,w,h}]
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.crm_expo_visits (
  id               text primary key,
  exhibition_id    text not null references public.crm_exhibitions(id) on delete cascade,
  contact_id       text,
  account_id       text,
  emp_id           text,          -- 誰掃的（＝之後由誰寄）
  memo             text,          -- 現場談話重點（給 AI 寫跟進信）
  lang             text,          -- 跟進信用的語言，感謝信沿用
  followup_sent_at timestamptz,
  quote_id         text,
  quote_sent_at    timestamptz,
  thanks_sent_at   timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists crm_expo_visits_exh_idx on public.crm_expo_visits (exhibition_id);

create table if not exists public.crm_mail_log (
  id            bigint generated always as identity primary key,
  kind          text not null,      -- followup／quote／thanks／test
  from_emp      text not null,
  from_email    text not null,
  to_email      text not null,
  subject       text,
  exhibition_id text,
  visit_id      text,
  ok            boolean not null,
  error         text,
  sent_at       timestamptz not null default now()
);
create index if not exists crm_mail_log_visit_idx on public.crm_mail_log (visit_id);

alter table public.crm_exhibitions enable row level security;
alter table public.crm_expo_visits enable row level security;
alter table public.crm_mail_log    enable row level security;
revoke all on public.crm_exhibitions, public.crm_expo_visits, public.crm_mail_log from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-expo', 'crm-expo', false, 26214400)
on conflict (id) do nothing;
