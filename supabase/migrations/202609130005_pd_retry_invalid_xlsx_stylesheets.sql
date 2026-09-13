-- Retry the five XLSX documents that LibreOffice can convert but openpyxl
-- rejected because their internal stylesheet XML is invalid.

with target as (
  select j.id as job_id, j.document_id
  from public.pd_mfg_jobs j
  join public.pd_mfg_documents d on d.id = j.document_id
  where j.status = 'failed'
    and j.attempts >= 3
    and d.extension = 'xlsx'
    and j.error_detail ilike '%could not read stylesheet%'
)
update public.pd_mfg_documents d
set analysis_status = 'queued', updated_at = now()
from target
where d.id = target.document_id;

update public.pd_mfg_jobs j
set status = 'queued', attempts = 0, worker_id = null, lease_until = null,
    error_detail = null, priority = 100, created_at = now(), updated_at = now()
where j.status = 'failed'
  and j.attempts >= 3
  and j.error_detail ilike '%could not read stylesheet%'
  and exists (
    select 1 from public.pd_mfg_documents d
    where d.id = j.document_id and d.extension = 'xlsx'
  );
