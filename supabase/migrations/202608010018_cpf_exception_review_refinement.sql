-- v1.06: only decisions that can materially corrupt a product master remain blocking.
-- Missing facts, conservative non-inference, design assets, and weak candidates are optional.

create or replace function public.cpf_finalize_optional_review(
  p_document_version_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_document_id uuid;
  v_analysis jsonb;
  v_deferred integer := 0;
  v_requires_review boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  select document_id, analysis_result into v_document_id, v_analysis
  from public.cpf_document_versions
  where id = p_document_version_id;
  if v_document_id is null then raise exception 'document_version_not_found'; end if;

  -- AI review_reasons are explanatory by default. They frequently describe
  -- intentionally missing data or facts the model correctly refused to infer.
  update public.cpf_review_tasks
  set priority = 'normal', updated_at = now(),
      payload = payload || jsonb_build_object(
        'blockingException', false, 'exceptionPolicy', 'v1.06'
      )
  where document_id = v_document_id and status = 'open'
    and review_type in ('field_conflict', 'product_split')
    and title <> '一份文件包含多個完整產品';

  -- Supplier identity, supplier role, and possible product duplication can
  -- materially alter sourcing or product-master decisions.
  update public.cpf_review_tasks
  set priority = 'high', updated_at = now(),
      payload = payload || jsonb_build_object(
        'blockingException', true, 'exceptionPolicy', 'v1.06'
      )
  where document_id = v_document_id and status = 'open'
    and review_type in ('supplier', 'duplicate');

  -- Only extremely low overall confidence is blocking. Ordinary uncertainty
  -- remains searchable and can be completed later during actual use.
  if coalesce((v_analysis->>'confidence')::numeric, 1) < 0.60 then
    insert into public.cpf_review_tasks(
      review_type, priority, title, description, document_id, payload
    ) values (
      'field_conflict', 'high', 'AI 整體信心極低',
      '產品身分或文件內容的整體辨識信心低於 60%，需要人工判斷。',
      v_document_id,
      jsonb_build_object(
        'blockingException', true, 'exceptionPolicy', 'v1.06'
      )
    );
  end if;

  -- Count only complete product masters, not variants, candidates, design
  -- assets, components, or commercial line items.
  if (select count(*) from jsonb_array_elements(
        coalesce(v_analysis->'products', '[]'::jsonb)
      ) product
      where coalesce(product->>'record_kind', 'product_candidate') = 'complete_product') > 1
     and not exists (
       select 1 from public.cpf_review_tasks
       where document_id = v_document_id and status = 'open'
         and priority = 'high' and review_type = 'product_split'
         and title = '一份文件包含多個完整產品'
     ) then
    insert into public.cpf_review_tasks(
      review_type, priority, title, description, document_id, payload
    ) values (
      'product_split', 'high', '一份文件包含多個完整產品',
      '請確認產品拆分與變體關係；AI 結果仍可搜尋，但不應自動合併主檔。',
      v_document_id,
      jsonb_build_object(
        'blockingException', true, 'exceptionPolicy', 'v1.06'
      )
    );
  end if;

  update public.cpf_review_tasks
  set status = 'dismissed', resolved_at = now(), updated_at = now(),
      payload = payload || jsonb_build_object(
        'optionalReviewDeferred', true, 'platformActor', p_actor,
        'exceptionPolicy', 'v1.06'
      )
  where document_id = v_document_id and status = 'open' and priority <> 'high';
  get diagnostics v_deferred = row_count;

  select exists (
    select 1 from public.cpf_review_tasks
    where document_id = v_document_id and status = 'open' and priority = 'high'
  ) into v_requires_review;

  update public.cpf_documents
  set processing_status = case when v_requires_review
        then 'needs_review'::public.cpf_processing_status
        else 'completed'::public.cpf_processing_status end,
      updated_at = now()
  where id = v_document_id;

  insert into public.cpf_audit_log(action, entity_type, entity_id, details)
  values (
    'cpf_finalize_optional_review', 'document', v_document_id::text,
    jsonb_build_object(
      'actor', p_actor, 'documentVersionId', p_document_version_id,
      'routineTasksDeferred', v_deferred,
      'requiresExceptionReview', v_requires_review,
      'exceptionPolicy', 'v1.06'
    )
  );

  return jsonb_build_object(
    'documentId', v_document_id,
    'routineTasksDeferred', v_deferred,
    'requiresReview', v_requires_review
  );
end;
$$;

create or replace function public.cpf_defer_routine_reviews(
  p_document_ids uuid[],
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_deferred integer := 0;
  v_documents integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if coalesce(array_length(p_document_ids, 1), 0) = 0
     or array_length(p_document_ids, 1) > 1000 then
    raise exception 'document_count_out_of_range';
  end if;

  update public.cpf_review_tasks
  set priority = 'normal', updated_at = now(),
      payload = payload || jsonb_build_object(
        'blockingException', false, 'exceptionPolicy', 'v1.06'
      )
  where document_id = any(p_document_ids) and status = 'open'
    and review_type in ('field_conflict', 'product_split')
    and title <> '一份文件包含多個完整產品';

  update public.cpf_review_tasks
  set priority = 'high', updated_at = now(),
      payload = payload || jsonb_build_object(
        'blockingException', true, 'exceptionPolicy', 'v1.06'
      )
  where document_id = any(p_document_ids) and status = 'open'
    and review_type in ('supplier', 'duplicate');

  update public.cpf_review_tasks
  set status = 'dismissed', resolved_at = now(), updated_at = now(),
      payload = payload || jsonb_build_object(
        'optionalReviewDeferred', true, 'platformActor', p_actor,
        'exceptionPolicy', 'v1.06'
      )
  where document_id = any(p_document_ids)
    and status = 'open' and priority <> 'high';
  get diagnostics v_deferred = row_count;

  update public.cpf_documents document
  set processing_status = 'completed', updated_at = now()
  where document.id = any(p_document_ids) and document.deleted_at is null
    and not exists (
      select 1 from public.cpf_review_tasks task
      where task.document_id = document.id
        and task.status = 'open' and task.priority = 'high'
    );
  get diagnostics v_documents = row_count;

  update public.cpf_processing_jobs job
  set status = 'completed', progress = 100,
      message = 'AI 結果已可使用；一般資料待日後補充', updated_at = now()
  where job.document_id = any(p_document_ids) and job.status = 'needs_review'
    and not exists (
      select 1 from public.cpf_review_tasks task
      where task.document_id = job.document_id
        and task.status = 'open' and task.priority = 'high'
    );

  insert into public.cpf_audit_log(action, entity_type, details)
  values (
    'cpf_defer_routine_reviews', 'document_batch',
    jsonb_build_object(
      'actor', p_actor, 'documentIds', p_document_ids,
      'routineTasksDeferred', v_deferred,
      'documentsCompleted', v_documents,
      'exceptionPolicy', 'v1.06'
    )
  );

  return jsonb_build_object(
    'documentsCompleted', v_documents,
    'routineTasksDeferred', v_deferred
  );
end;
$$;

revoke all on function public.cpf_finalize_optional_review(uuid, text)
from public, anon, authenticated;
grant execute on function public.cpf_finalize_optional_review(uuid, text)
to service_role;
revoke all on function public.cpf_defer_routine_reviews(uuid[], text)
from public, anon, authenticated;
grant execute on function public.cpf_defer_routine_reviews(uuid[], text)
to service_role;

-- Align existing open review tasks with the refined blocking policy.
update public.cpf_review_tasks
set priority = 'normal', updated_at = now(),
    payload = payload || jsonb_build_object(
      'blockingException', false, 'exceptionPolicy', 'v1.06'
    )
where status = 'open'
  and review_type in ('field_conflict', 'product_split')
  and title <> '一份文件包含多個完整產品';

update public.cpf_review_tasks
set priority = 'high', updated_at = now(),
    payload = payload || jsonb_build_object(
      'blockingException', true, 'exceptionPolicy', 'v1.06'
    )
where status = 'open' and review_type in ('supplier', 'duplicate');

update public.cpf_review_tasks
set status = 'dismissed', resolved_at = now(), updated_at = now(),
    payload = payload || jsonb_build_object(
      'optionalReviewDeferred', true,
      'migrationApplied', 'v1.06'
    )
where status = 'open' and priority <> 'high';

update public.cpf_documents document
set processing_status = 'completed', updated_at = now()
where document.processing_status = 'needs_review'
  and not exists (
    select 1 from public.cpf_review_tasks task
    where task.document_id = document.id
      and task.status = 'open' and task.priority = 'high'
  );

update public.cpf_processing_jobs job
set status = 'completed', progress = 100,
    message = 'AI 結果已可使用；一般資料待日後補充', updated_at = now()
where job.status = 'needs_review'
  and not exists (
    select 1 from public.cpf_review_tasks task
    where task.document_id = job.document_id
      and task.status = 'open' and task.priority = 'high'
  );
