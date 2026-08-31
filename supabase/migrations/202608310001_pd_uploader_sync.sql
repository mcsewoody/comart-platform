-- Product Dev document transfer governance v2.12.
-- Adds Product Finder-only uploader access and non-destructive sync audit data.

alter table public.pd_mfg_documents
  add column if not exists uploaded_by text,
  add column if not exists uploaded_by_name text;

alter table public.pd_buy_documents
  add column if not exists uploaded_by text,
  add column if not exists uploaded_by_name text;

create table if not exists public.pd_uploaders (
  emp_id text primary key references public.users(emp_id) on update cascade on delete cascade,
  active boolean not null default true,
  granted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.pd_uploaders (emp_id, active, granted_by)
select emp_id, true, 'v2.12-migration'
from public.users
where active is distinct from false and role in ('admin', 'dcc')
on conflict (emp_id) do nothing;

create table if not exists public.pd_transfer_audit (
  id uuid primary key default gen_random_uuid(),
  emp_id text not null,
  action text not null check (action in ('upload', 'download_request')),
  dataset text not null check (dataset in ('mfg', 'buy')),
  document_id uuid,
  relative_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists pd_transfer_audit_created_idx
  on public.pd_transfer_audit (created_at desc);
create index if not exists pd_transfer_audit_emp_idx
  on public.pd_transfer_audit (emp_id, created_at desc);

alter table public.pd_uploaders enable row level security;
alter table public.pd_transfer_audit enable row level security;
revoke all on public.pd_uploaders from anon, authenticated;
revoke all on public.pd_transfer_audit from anon, authenticated;
grant all on public.pd_uploaders to service_role;
grant all on public.pd_transfer_audit to service_role;
