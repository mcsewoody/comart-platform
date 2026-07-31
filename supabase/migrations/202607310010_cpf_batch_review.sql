-- Batch approval for document-grouped human review. CPF objects only.
create or replace function public.cpf_batch_approve_documents(
  p_document_ids uuid[],
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_resolved integer := 0;
  v_documents integer := 0;
  v_products integer := 0;
  v_confirmable_products uuid[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if coalesce(array_length(p_document_ids, 1), 0) = 0
     or array_length(p_document_ids, 1) > 100 then
    raise exception 'document_count_out_of_range';
  end if;

  update public.cpf_review_tasks
  set status = 'resolved', resolved_at = v_now, updated_at = v_now,
      payload = payload || jsonb_build_object(
        'batchApproved', true, 'platformActor', p_actor
      )
  where status = 'open' and document_id = any(p_document_ids);
  get diagnostics v_resolved = row_count;

  select coalesce(array_agg(distinct pd.product_id), '{}'::uuid[])
  into v_confirmable_products
  from public.cpf_product_documents pd
  where pd.document_id = any(p_document_ids)
    and not exists (
      select 1 from public.cpf_review_tasks rt
      where rt.product_id = pd.product_id and rt.status = 'open'
    );

  update public.cpf_products
  set confirmation_status = 'human_confirmed',
      manual_overrides = manual_overrides || jsonb_build_object(
        'name_original', true, 'name_zh_tw', true, 'name_en', true,
        'name_vi', true, 'brand', true, 'model_numbers', true,
        'category_id', true, 'functions', true, 'keywords', true
      ),
      updated_at = v_now
  where id = any(v_confirmable_products) and deleted_at is null;
  get diagnostics v_products = row_count;

  update public.cpf_specifications
  set confirmation_status = 'human_confirmed', updated_at = v_now
  where product_id = any(v_confirmable_products);
  update public.cpf_product_suppliers
  set confirmation_status = 'human_confirmed'
  where product_id = any(v_confirmable_products);
  update public.cpf_quotes
  set confirmation_status = 'human_confirmed', updated_at = v_now
  where product_id = any(v_confirmable_products);
  update public.cpf_evidence
  set confirmation_status = 'human_confirmed'
  where product_id = any(v_confirmable_products)
     or document_version_id in (
       select id from public.cpf_document_versions
       where document_id = any(p_document_ids)
     );

  update public.cpf_documents
  set processing_status = 'completed', updated_at = v_now
  where id = any(p_document_ids) and deleted_at is null;
  get diagnostics v_documents = row_count;

  update public.cpf_processing_jobs
  set status = 'completed', progress = 100,
      message = '人工批次接受目前 AI 結果', updated_at = v_now
  where document_id = any(p_document_ids) and status = 'needs_review';

  return jsonb_build_object(
    'documentsApproved', v_documents,
    'productsConfirmed', v_products,
    'reviewTasksResolved', v_resolved
  );
end;
$$;

revoke all on function public.cpf_batch_approve_documents(uuid[], text)
from public, anon, authenticated;
grant execute on function public.cpf_batch_approve_documents(uuid[], text)
to service_role;
