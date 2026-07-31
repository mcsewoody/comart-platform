-- Apply one AI result atomically. Repeated workers are idempotent per version.

create or replace function public.cpf_apply_ai_extraction(
  p_document_version_id uuid,
  p_result jsonb,
  p_embedding public.halfvec(3072),
  p_model text,
  p_prompt_version text,
  p_usage jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_version public.cpf_document_versions%rowtype;
  v_document public.cpf_documents%rowtype;
  v_product jsonb;
  v_spec jsonb;
  v_evidence jsonb;
  v_supplier jsonb;
  v_quote jsonb;
  v_tier jsonb;
  v_product_id uuid;
  v_category_id uuid;
  v_supplier_id uuid;
  v_quote_id uuid;
  v_evidence_id uuid;
  v_other_product_id uuid;
  v_product_ids jsonb := '[]'::jsonb;
  v_status public.cpf_confirmation_status;
  v_needs_review boolean;
  v_reason text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  select * into v_version
  from public.cpf_document_versions
  where id = p_document_version_id
  for update;
  if not found then raise exception 'version_not_found'; end if;

  if coalesce((v_version.analysis_result->>'applied')::boolean, false) then
    return v_version.analysis_result;
  end if;

  select * into v_document
  from public.cpf_documents where id = v_version.document_id
  for update;

  v_needs_review :=
    jsonb_array_length(coalesce(p_result->'review_reasons', '[]'::jsonb)) > 0
    or jsonb_array_length(coalesce(p_result->'products', '[]'::jsonb)) > 1
    or coalesce((p_result->>'confidence')::numeric, 0) < 0.9;

  for v_product in
    select value from jsonb_array_elements(
      coalesce(p_result->'products', '[]'::jsonb)
    )
  loop
    v_category_id := null;
    if nullif(v_product->>'category_name', '') is not null then
      select id into v_category_id
      from public.cpf_categories
      where deleted_at is null
        and (
          lower(name_zh_tw) = lower(v_product->>'category_name')
          or lower(coalesce(name_en, '')) = lower(v_product->>'category_name')
          or lower(coalesce(name_vi, '')) = lower(v_product->>'category_name')
        )
      limit 1;
      if v_category_id is null then v_needs_review := true; end if;
    end if;

    v_status := case
      when coalesce((v_product->>'confidence')::numeric, 0) >= 0.9
        then 'ai_high_confidence'::public.cpf_confirmation_status
      else 'needs_review'::public.cpf_confirmation_status
    end;

    insert into public.cpf_products(
      name_original, name_zh_tw, name_en, name_vi, brand, model_numbers,
      category_id, functions, keywords, confirmation_status,
      representative_thumbnail_path, embedding
    ) values (
      coalesce(nullif(v_product->>'name_original', ''), v_document.title),
      coalesce(nullif(v_product->>'name_zh_tw', ''), v_document.title),
      coalesce(v_product->>'name_en', ''),
      coalesce(v_product->>'name_vi', ''),
      nullif(v_product->>'brand', ''),
      array(select jsonb_array_elements_text(
        coalesce(v_product->'model_numbers', '[]'::jsonb)
      )),
      v_category_id,
      array(select jsonb_array_elements_text(
        coalesce(v_product->'functions', '[]'::jsonb)
      )),
      array(select jsonb_array_elements_text(
        coalesce(v_product->'keywords', '[]'::jsonb)
      )),
      v_status,
      coalesce(
        nullif(v_product->>'representative_thumbnail_path', ''),
        v_version.thumbnail_path
      ),
      p_embedding
    ) returning id into v_product_id;

    v_product_ids := v_product_ids || jsonb_build_array(v_product_id);
    insert into public.cpf_product_documents(product_id, document_id)
    values (v_product_id, v_document.id)
    on conflict do nothing;

    for v_spec in
      select value from jsonb_array_elements(
        coalesce(v_product->'specifications', '[]'::jsonb)
      )
    loop
      insert into public.cpf_specifications(
        product_id, name, value_text, value_number, unit, source_text,
        confirmation_status
      ) values (
        v_product_id,
        v_spec->>'name',
        nullif(v_spec->>'value_text', ''),
        nullif(v_spec->>'value_number', '')::numeric,
        nullif(v_spec->>'unit', ''),
        coalesce(v_spec->>'source_text', ''),
        case when coalesce((v_spec->>'confidence')::numeric, 0) >= 0.9
          then 'ai_high_confidence'::public.cpf_confirmation_status
          else 'needs_review'::public.cpf_confirmation_status end
      );
    end loop;

    for v_evidence in
      select value from jsonb_array_elements(
        coalesce(v_product->'evidence', '[]'::jsonb)
      )
    loop
      insert into public.cpf_evidence(
        document_version_id, product_id, field_name, source_locator,
        excerpt, confidence, confirmation_status
      ) values (
        v_version.id, v_product_id, v_evidence->>'field_name',
        coalesce(v_evidence->>'source_locator', 'document'),
        nullif(v_evidence->>'excerpt', ''),
        nullif(v_evidence->>'confidence', '')::numeric,
        case when coalesce((v_evidence->>'confidence')::numeric, 0) >= 0.9
          then 'ai_high_confidence'::public.cpf_confirmation_status
          else 'needs_review'::public.cpf_confirmation_status end
      );
    end loop;

    for v_supplier in
      select value from jsonb_array_elements(
        coalesce(v_product->'suppliers', '[]'::jsonb)
      )
    loop
      v_supplier_id := null;
      select s.id into v_supplier_id
      from public.cpf_suppliers s
      where s.deleted_at is null
        and (
          lower(s.legal_name) = lower(v_supplier->>'original_name')
          or exists (
            select 1 from public.cpf_supplier_aliases a
            where a.supplier_id = s.id
              and lower(a.alias) = lower(v_supplier->>'original_name')
          )
        )
      limit 1;

      if v_supplier_id is null
        or not coalesce((v_supplier->>'explicit_in_document')::boolean, false)
      then
        v_needs_review := true;
        insert into public.cpf_review_tasks(
          review_type, priority, title, description, document_id,
          product_id, payload
        ) values (
          'supplier', 'high', '廠商身分需確認',
          'AI 不得依檔名、路徑或 Logo 推定原廠／貿易商角色。',
          v_document.id, v_product_id, v_supplier
        );
      end if;

      if v_supplier_id is not null then
        insert into public.cpf_evidence(
          document_version_id, product_id, field_name, source_locator,
          excerpt, confidence, confirmation_status
        ) values (
          v_version.id, v_product_id, 'supplier',
          coalesce(v_supplier->'evidence'->>'source_locator', 'document'),
          nullif(v_supplier->'evidence'->>'excerpt', ''),
          nullif(v_supplier->>'confidence', '')::numeric,
          'needs_review'
        ) returning id into v_evidence_id;

        insert into public.cpf_product_suppliers(
          product_id, supplier_id, supplier_role, confirmation_status, evidence_id
        ) values (
          v_product_id, v_supplier_id,
          coalesce(
            nullif(v_supplier->>'role', '')::public.cpf_supplier_role,
            'unknown'::public.cpf_supplier_role
          ),
          'needs_review', v_evidence_id
        ) on conflict do nothing;
      end if;
    end loop;

    v_quote := v_product->'quote';
    if v_quote is not null and v_quote <> 'null'::jsonb then
      insert into public.cpf_quotes(
        product_id, document_version_id, quote_date, currency, moq,
        lead_time_days, incoterm, confirmation_status
      ) values (
        v_product_id, v_version.id,
        nullif(v_quote->>'quote_date', '')::date,
        upper(nullif(v_quote->>'currency', '')),
        nullif(v_quote->>'moq', '')::integer,
        nullif(v_quote->>'lead_time_days', '')::integer,
        nullif(v_quote->>'incoterm', ''),
        'needs_review'
      ) returning id into v_quote_id;

      for v_tier in
        select value from jsonb_array_elements(
          coalesce(v_quote->'tiers', '[]'::jsonb)
        )
      loop
        insert into public.cpf_quote_tiers(
          quote_id, min_quantity, max_quantity, unit_price
        ) values (
          v_quote_id,
          (v_tier->>'min_quantity')::integer,
          nullif(v_tier->>'max_quantity', '')::integer,
          (v_tier->>'unit_price')::numeric
        );
      end loop;
      v_needs_review := true;
    end if;

    for v_other_product_id in
      select distinct other.id
      from public.cpf_products other
      where other.id <> v_product_id
        and other.deleted_at is null
        and cardinality(other.model_numbers) > 0
        and other.model_numbers && array(
          select jsonb_array_elements_text(
            coalesce(v_product->'model_numbers', '[]'::jsonb)
          )
        )
    loop
      insert into public.cpf_duplicate_suggestions(
        product_a_id, product_b_id, similarity, evidence
      ) values (
        least(v_product_id, v_other_product_id),
        greatest(v_product_id, v_other_product_id),
        0.98,
        jsonb_build_object('reason', 'exact_model_overlap')
      ) on conflict do nothing;
      insert into public.cpf_review_tasks(
        review_type, priority, title, description, document_id,
        product_id, payload
      ) values (
        'duplicate', 'normal', '疑似重複產品',
        '型號完全重疊；請選擇合併、建立變體或維持不同產品。',
        v_document.id, v_product_id,
        jsonb_build_object('otherProductId', v_other_product_id)
      );
      v_needs_review := true;
    end loop;
  end loop;

  for v_reason in
    select value #>> '{}' from jsonb_array_elements(
      coalesce(p_result->'review_reasons', '[]'::jsonb)
    )
  loop
    insert into public.cpf_review_tasks(
      review_type, priority, title, description, document_id, payload
    ) values (
      case when jsonb_array_length(coalesce(p_result->'products', '[]')) > 1
        then 'product_split'::public.cpf_review_type
        else 'field_conflict'::public.cpf_review_type end,
      'high', 'AI 分析需要人工判斷', v_reason, v_document.id,
      jsonb_build_object('reason', v_reason)
    );
  end loop;

  update public.cpf_document_versions
  set embedding = p_embedding,
      openai_model = p_model,
      prompt_version = p_prompt_version,
      ai_usage = coalesce(p_usage, '{}'::jsonb),
      analysis_result = p_result || jsonb_build_object(
        'applied', true, 'productIds', v_product_ids
      )
  where id = v_version.id;

  update public.cpf_documents
  set document_type = coalesce(
        nullif(p_result->>'document_type', '')::public.cpf_document_type,
        'other'::public.cpf_document_type
      ),
      processing_status = case when v_needs_review
        then 'needs_review'::public.cpf_processing_status
        else 'completed'::public.cpf_processing_status end
  where id = v_document.id;

  return p_result || jsonb_build_object(
    'applied', true,
    'productIds', v_product_ids,
    'needsReview', v_needs_review
  );
end;
$$;

revoke all on function public.cpf_apply_ai_extraction(
  uuid, jsonb, public.halfvec, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.cpf_apply_ai_extraction(
  uuid, jsonb, public.halfvec, text, text, jsonb
) to service_role;
