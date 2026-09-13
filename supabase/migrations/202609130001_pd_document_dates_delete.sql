-- Product Finder v2.19: document date/revision evidence and deletion audit.

alter table public.pd_mfg_documents
  add column if not exists primary_document_date date,
  add column if not exists primary_date_type text check (primary_date_type in (
    'quotation_date', 'issue_date', 'revision_date', 'creation_date', 'filename_date', 'manual'
  )),
  add column if not exists primary_date_evidence text,
  add column if not exists primary_date_location text,
  add column if not exists revision_label text,
  add column if not exists revision_evidence text,
  add column if not exists revision_location text;

alter table public.pd_buy_documents
  add column if not exists primary_document_date date,
  add column if not exists primary_date_type text check (primary_date_type in (
    'quotation_date', 'issue_date', 'revision_date', 'creation_date', 'filename_date', 'manual'
  )),
  add column if not exists primary_date_evidence text,
  add column if not exists primary_date_location text,
  add column if not exists revision_label text,
  add column if not exists revision_evidence text,
  add column if not exists revision_location text;

alter table public.pd_transfer_audit
  drop constraint if exists pd_transfer_audit_action_check;
alter table public.pd_transfer_audit
  add constraint pd_transfer_audit_action_check
  check (action in ('upload', 'download_request', 'delete'));

comment on column public.pd_mfg_documents.primary_document_date is
  'Primary business date found in document content; null when no evidence exists.';
comment on column public.pd_buy_documents.primary_document_date is
  'Primary business date found in document content; null when no evidence exists.';
