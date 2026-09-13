-- Ensure the approved BOM/quotation backfill runs ahead of the general queue.
-- pd_claim_jobs orders by created_at ascending, so priority work receives an
-- intentionally old queue timestamp without changing document creation dates.

update public.pd_mfg_jobs j
set created_at = timestamptz '2000-01-01 00:00:00+00', updated_at = now()
from public.pd_mfg_documents d
where j.document_id = d.id
  and j.status = 'queued'
  and d.extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
  and (
    d.document_kind = 'bom'
    or d.relative_path ~* '(bom|物料|報價|报价|估價|估价|成本|cost|quotation|quote)'
  );

update public.pd_buy_jobs j
set created_at = timestamptz '2000-01-01 00:00:00+00', updated_at = now()
from public.pd_buy_documents d
where j.document_id = d.id
  and j.status = 'queued'
  and d.extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
  and (
    d.document_kind = 'quotation'
    or d.relative_path ~* '(報價|报价|估價|估价|price|pricing|quotation|quote)'
  );
