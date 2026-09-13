-- Product Finder v2.21: separate write/upload access from full-library sync.
-- Existing allow-list entries keep upload access only. No user, including an
-- administrator, receives full-library download access implicitly.

alter table public.pd_uploaders
  add column if not exists can_sync boolean not null default false;

comment on column public.pd_uploaders.active is
  'Allows Product Finder upload, metadata editing, and AI analysis operations.';
comment on column public.pd_uploaders.can_sync is
  'Allows manifest access and downloading all missing original files to a local directory.';
