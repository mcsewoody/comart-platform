-- One-time v2.19 date/revision backfill: prioritize BOM and quotation documents.
-- Only deep-analysis formats are requeued; CAD and video metadata remain untouched.

with target as (
  select id
  from public.pd_mfg_documents
  where extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
    and (primary_document_date is null or revision_label is null)
    and (
      document_kind = 'bom'
      or relative_path ~* '(bom|物料|報價|报价|估價|估价|成本|cost|quotation|quote)'
    )
)
update public.pd_mfg_documents d
set analysis_status = 'queued', updated_at = now()
from target
where d.id = target.id;

insert into public.pd_mfg_jobs (document_id, status, attempts, worker_id, lease_until, error_detail, updated_at)
select d.id, 'queued', 0, null, null, null, now()
from public.pd_mfg_documents d
where d.analysis_status = 'queued'
  and d.extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
  and (
    d.document_kind = 'bom'
    or d.relative_path ~* '(bom|物料|報價|报价|估價|估价|成本|cost|quotation|quote)'
  )
on conflict (document_id) do update
set status = 'queued', attempts = 0, worker_id = null, lease_until = null,
    error_detail = null, updated_at = now();

with target as (
  select id
  from public.pd_buy_documents
  where extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
    and (primary_document_date is null or revision_label is null)
    and (
      document_kind = 'quotation'
      or relative_path ~* '(報價|报价|估價|估价|price|pricing|quotation|quote)'
    )
)
update public.pd_buy_documents d
set analysis_status = 'queued', updated_at = now()
from target
where d.id = target.id;

insert into public.pd_buy_jobs (document_id, status, attempts, worker_id, lease_until, error_detail, updated_at)
select d.id, 'queued', 0, null, null, null, now()
from public.pd_buy_documents d
where d.analysis_status = 'queued'
  and d.extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
  and (
    d.document_kind = 'quotation'
    or d.relative_path ~* '(報價|报价|估價|估价|price|pricing|quotation|quote)'
  )
on conflict (document_id) do update
set status = 'queued', attempts = 0, worker_id = null, lease_until = null,
    error_detail = null, updated_at = now();
