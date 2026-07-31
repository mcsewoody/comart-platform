-- Product Finder integration with COMART Platform's signed employee session (migration 9).
-- This migration is additive: it does not alter or rewrite existing KMS/CPF rows.

create table if not exists public.cpf_platform_document_access_grants (
  document_id uuid not null references public.cpf_documents(id) on delete cascade,
  emp_id text not null references public.users(emp_id) on delete cascade,
  can_read boolean not null default true,
  granted_by_emp_id text not null references public.users(emp_id),
  created_at timestamptz not null default now(),
  primary key (document_id, emp_id)
);

alter table public.cpf_platform_document_access_grants enable row level security;

revoke all on public.cpf_platform_document_access_grants
  from public, anon, authenticated;
grant all on public.cpf_platform_document_access_grants to service_role;

comment on table public.cpf_platform_document_access_grants is
  'Per-employee access overrides for highly confidential CPF documents when using COMART Platform sessions.';
