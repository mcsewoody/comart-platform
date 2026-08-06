-- 027_premortem_tables.sql
--
-- 事前驗屍會議（Premortem）子系統 — 三張表。
-- 存取一律經 sb-proxy（service_role）+ x-session 簽章；因此啟用 RLS、不加任何 anon policy：
-- 擋掉以 anon key 直連 REST 的未授權讀寫，sb-proxy 的 service_role 會繞過 RLS 照常運作
-- （與 board 其餘表 weekly_minutes / biz_meeting_minutes / woody_reports 同一套安全模型）。
--
-- id 用 text（前端 uid() 產生 'b...' 字串），與 board 慣例一致。

create table if not exists public.premortem_sessions (
  id            text primary key,
  title         text not null default '',
  project_desc  text default '',            -- 被驗屍的專案描述
  scenario      text default '',            -- 情境設定文字（想像已徹底失敗）
  lang_a        text default 'zh-TW',       -- 主席畫面並陳語言 A（階段2 起用）
  lang_b        text default 'vi',          -- 並陳語言 B
  scope_type    text default 'all',         -- all | site | list
  scope_site    text,                       -- scope_type=site 時的中心
  scope_members jsonb default '[]'::jsonb,  -- scope_type=list 時的 emp_id 陣列
  chair_emp_id  text,
  chair_name    text,
  phase         text default 'setup',       -- setup|writing|reveal|ranking|mitigation|locked
  roster_locked boolean default false,
  created_by    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.premortem_entries (
  id            text primary key,
  session_id    text not null references public.premortem_sessions(id) on delete cascade,
  author_emp_id text,                        -- 填寫者（匿名顯示時前端不揭露，主席可見）
  author_name   text,
  src_lang      text,                        -- 原文語言
  text_src      text default '',             -- 原文
  text_a        text,                        -- 譯文 A（階段2 起）
  text_b        text,                        -- 譯文 B
  theme         text,                        -- AI 分群主題（階段3 起）
  voters        jsonb default '[]'::jsonb,   -- 投票者 emp_id 陣列（階段3 起）
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_premortem_entries_session on public.premortem_entries(session_id);

create table if not exists public.premortem_mitigations (
  id            text primary key,
  session_id    text not null references public.premortem_sessions(id) on delete cascade,
  risk_summary  text default '',             -- 對應的重點風險/主題
  risk_a        text, risk_b text,
  measure       text default '',             -- 對策措施
  measure_a     text, measure_b text,
  owner_emp_id  text,
  owner_name    text,
  due_date      date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_premortem_mitig_session on public.premortem_mitigations(session_id);

alter table public.premortem_sessions   enable row level security;
alter table public.premortem_entries     enable row level security;
alter table public.premortem_mitigations enable row level security;
