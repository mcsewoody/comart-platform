-- Correct v2.19 backfill targeting and make priority ordering explicit.
-- Folder names such as BOM/quotation no longer cause every nested drawing to be
-- treated as a BOM or quotation document.

alter table public.pd_mfg_jobs
  add column if not exists priority integer not null default 0
  check (priority between 0 and 100);

alter table public.pd_buy_jobs
  add column if not exists priority integer not null default 0
  check (priority between 0 and 100);

create or replace function public.pd_claim_jobs(
  p_dataset text,
  p_worker_id text,
  p_limit integer default 5,
  p_lease_minutes integer default 20
)
returns table(id uuid, document_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  target_table regclass;
begin
  if p_dataset = 'mfg' then target_table := 'public.pd_mfg_jobs'::regclass;
  elsif p_dataset = 'buy' then target_table := 'public.pd_buy_jobs'::regclass;
  else raise exception 'invalid dataset';
  end if;

  return query execute format(
    'with selected as (
       select j.id, j.priority, j.created_at from %s j
       where (j.status in (''queued'',''failed'') and j.attempts < 3)
          or (j.status = ''processing'' and j.lease_until < now())
       order by j.priority desc, j.created_at, j.id
       for update skip locked
       limit $1
     ), updated as (
       update %s j set status = ''processing'', worker_id = $2,
         lease_until = now() + make_interval(mins => $3),
         attempts = j.attempts + 1, error_detail = null, updated_at = now()
       from selected where j.id = selected.id
       returning j.id, j.document_id
     )
     select updated.id, updated.document_id
     from updated join selected on selected.id = updated.id
     order by selected.priority desc, selected.created_at, selected.id',
    target_table, target_table
  ) using least(greatest(coalesce(p_limit, 5), 1), 50), p_worker_id,
    least(greatest(coalesce(p_lease_minutes, 20), 5), 60);
end;
$$;

update public.pd_mfg_jobs set priority = 0 where priority <> 0;
update public.pd_buy_jobs set priority = 0 where priority <> 0;

with target as (
  select id
  from public.pd_mfg_documents
  where extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
    and (
      document_kind = 'bom'
      or regexp_replace(relative_path, '^.*/', '') ~* '(bom|物料|報價|报价|估價|估价|成本|cost|quotation|quote)'
    )
)
update public.pd_mfg_documents d
set analysis_status = 'queued',
    primary_document_date = null, primary_date_type = null,
    primary_date_evidence = null, primary_date_location = null,
    revision_label = null, revision_evidence = null, revision_location = null,
    updated_at = now()
from target
where d.id = target.id;

insert into public.pd_mfg_jobs
  (document_id, status, attempts, worker_id, lease_until, error_detail, priority, created_at, updated_at)
select d.id, 'queued', 0, null, null, null, 100, now(), now()
from public.pd_mfg_documents d
where d.analysis_status = 'queued'
  and d.extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
  and (
    d.document_kind = 'bom'
    or regexp_replace(d.relative_path, '^.*/', '') ~* '(bom|物料|報價|报价|估價|估价|成本|cost|quotation|quote)'
  )
on conflict (document_id) do update
set status = 'queued', attempts = 0, worker_id = null, lease_until = null,
    error_detail = null, priority = 100, created_at = now(), updated_at = now();

with target as (
  select id
  from public.pd_buy_documents
  where extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
    and (
      document_kind = 'quotation'
      or regexp_replace(relative_path, '^.*/', '') ~* '(報價|报价|估價|估价|price|pricing|quotation|quote)'
    )
)
update public.pd_buy_documents d
set analysis_status = 'queued',
    primary_document_date = null, primary_date_type = null,
    primary_date_evidence = null, primary_date_location = null,
    revision_label = null, revision_evidence = null, revision_location = null,
    updated_at = now()
from target
where d.id = target.id;

insert into public.pd_buy_jobs
  (document_id, status, attempts, worker_id, lease_until, error_detail, priority, created_at, updated_at)
select d.id, 'queued', 0, null, null, null, 100, now(), now()
from public.pd_buy_documents d
where d.analysis_status = 'queued'
  and d.extension in ('jpg','jpeg','png','pdf','ppt','pptx','xls','xlsx','doc','docx')
  and (
    d.document_kind = 'quotation'
    or regexp_replace(d.relative_path, '^.*/', '') ~* '(報價|报价|估價|估价|price|pricing|quotation|quote)'
  )
on conflict (document_id) do update
set status = 'queued', attempts = 0, worker_id = null, lease_until = null,
    error_detail = null, priority = 100, created_at = now(), updated_at = now();
