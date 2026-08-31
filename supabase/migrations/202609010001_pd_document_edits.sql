-- Product Finder v2.13 document metadata edit audit.

create table if not exists public.pd_document_edits (
  id uuid primary key default gen_random_uuid(),
  dataset text not null check (dataset in ('mfg', 'buy')),
  document_id uuid not null,
  edited_by text not null,
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists pd_document_edits_document_idx
  on public.pd_document_edits (dataset, document_id, created_at desc);
create index if not exists pd_document_edits_editor_idx
  on public.pd_document_edits (edited_by, created_at desc);

alter table public.pd_document_edits enable row level security;
revoke all on public.pd_document_edits from anon, authenticated;
grant all on public.pd_document_edits to service_role;
