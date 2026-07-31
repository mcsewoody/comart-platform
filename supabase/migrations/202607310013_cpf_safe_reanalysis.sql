-- Recoverable v2 reanalysis gate for a small approved document batch.

create table if not exists public.cpf_analysis_revisions (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null
    references public.cpf_document_versions(id) on delete cascade,
  analysis_result jsonb,
  openai_model text,
  prompt_version text,
  ai_usage jsonb not null default '{}'::jsonb,
  archived_product_ids uuid[] not null default '{}',
  reason text not null,
  actor text,
  created_at timestamptz not null default now()
);

alter table public.cpf_analysis_revisions enable row level security;

create or replace function public.cpf_prepare_reanalysis_v2(
  p_document_ids uuid[],
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_document_id uuid;
  v_version public.cpf_document_versions%rowtype;
  v_archivable_products uuid[];
  v_archived_count integer := 0;
  v_preserved_count integer := 0;
  v_queued_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if coalesce(array_length(p_document_ids, 1), 0) = 0
     or array_length(p_document_ids, 1) > 10 then
    raise exception 'reanalysis_gate_requires_1_to_10_documents';
  end if;
  if exists (
    select 1 from unnest(p_document_ids) requested(id)
    where not exists (
      select 1 from public.cpf_documents d
      where d.id = requested.id and d.deleted_at is null
    )
  ) then
    raise exception 'document_not_found';
  end if;

  select coalesce(array_agg(distinct p.id), '{}'::uuid[])
  into v_archivable_products
  from public.cpf_products p
  where p.deleted_at is null
    and exists (
      select 1 from public.cpf_product_documents pd
      where pd.product_id = p.id and pd.document_id = any(p_document_ids)
    )
    and not exists (
      select 1 from public.cpf_product_documents outside_link
      where outside_link.product_id = p.id
        and outside_link.document_id <> all(p_document_ids)
    )
    and not exists (
      select 1 from public.cpf_audit_log audit
      where audit.action = 'platform_manual_update'
        and audit.entity_type = 'product'
        and audit.entity_id = p.id::text
    );

  select count(*) into v_preserved_count
  from public.cpf_products p
  where p.deleted_at is null
    and exists (
      select 1 from public.cpf_product_documents pd
      where pd.product_id = p.id and pd.document_id = any(p_document_ids)
    )
    and not (p.id = any(v_archivable_products));

  update public.cpf_products
  set deleted_at = now(), updated_at = now()
  where id = any(v_archivable_products);
  get diagnostics v_archived_count = row_count;

  for v_document_id in select distinct unnest(p_document_ids)
  loop
    select v.* into v_version
    from public.cpf_document_versions v
    join public.cpf_documents d on d.current_version_id = v.id
    where d.id = v_document_id
    for update;

    insert into public.cpf_analysis_revisions(
      document_version_id, analysis_result, openai_model, prompt_version,
      ai_usage, archived_product_ids, reason, actor
    ) values (
      v_version.id, v_version.analysis_result, v_version.openai_model,
      v_version.prompt_version, v_version.ai_usage,
      array(
        select pd.product_id from public.cpf_product_documents pd
        where pd.document_id = v_document_id
          and pd.product_id = any(v_archivable_products)
      ),
      'cpf-product-creation-v2 reanalysis gate', p_actor
    );

    delete from public.cpf_extracted_items
    where document_version_id = v_version.id;

    update public.cpf_document_versions
    set analysis_result = null,
        embedding = null,
        openai_model = null,
        prompt_version = null,
        ai_usage = '{}'::jsonb
    where id = v_version.id;

    update public.cpf_review_tasks
    set status = 'dismissed', resolved_at = now(), updated_at = now(),
        payload = payload || jsonb_build_object(
          'supersededByPolicy', 'cpf-product-creation-v2',
          'platformActor', p_actor
        )
    where document_id = v_document_id and status = 'open';

    update public.cpf_documents
    set processing_status = 'queued', updated_at = now()
    where id = v_document_id;

    insert into public.cpf_processing_jobs(
      document_id, document_version_id, status, progress, message
    ) values (
      v_document_id, v_version.id, 'queued', 0,
      '產品建立規則 v2 重新分析'
    );
    v_queued_count := v_queued_count + 1;
  end loop;

  insert into public.cpf_audit_log(
    action, entity_type, details
  ) values (
    'cpf_prepare_reanalysis_v2', 'document_batch',
    jsonb_build_object(
      'actor', p_actor,
      'documentIds', p_document_ids,
      'archivedProductIds', v_archivable_products,
      'preservedProductCount', v_preserved_count
    )
  );

  return jsonb_build_object(
    'documentsQueued', v_queued_count,
    'productsSoftArchived', v_archived_count,
    'manuallyEditedProductsPreserved', v_preserved_count
  );
end;
$$;

revoke all on function public.cpf_prepare_reanalysis_v2(uuid[], text)
from public, anon, authenticated;
grant execute on function public.cpf_prepare_reanalysis_v2(uuid[], text)
to service_role;
