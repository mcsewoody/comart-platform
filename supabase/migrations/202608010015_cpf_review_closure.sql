-- v1.02: close the document -> product -> category/supplier review loop.
-- All writes stay inside cpf_ objects and are service-role only.

create or replace function public.cpf_resolve_extracted_item(
  p_item_id uuid,
  p_action text,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_supplier_links jsonb default null,
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.cpf_extracted_items%rowtype;
  v_version public.cpf_document_versions%rowtype;
  v_document_id uuid;
  v_target_product_id uuid;
  v_supplier jsonb;
  v_role public.cpf_supplier_role;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if p_action not in ('create', 'link', 'keep') then
    raise exception 'invalid_resolution_action';
  end if;

  select * into v_item
  from public.cpf_extracted_items
  where id = p_item_id
  for update;
  if not found then raise exception 'extracted_item_not_found'; end if;
  if v_item.review_status <> 'open' then
    raise exception 'extracted_item_already_resolved';
  end if;

  select * into v_version
  from public.cpf_document_versions
  where id = v_item.document_version_id;
  if not found then raise exception 'document_version_not_found'; end if;
  v_document_id := v_version.document_id;

  if p_category_id is not null and not exists (
    select 1 from public.cpf_categories
    where id = p_category_id and deleted_at is null
  ) then
    raise exception 'category_not_found';
  end if;

  if p_action = 'create' then
    insert into public.cpf_products(
      name_original, name_zh_tw, name_en, name_vi, brand, model_numbers,
      category_id, functions, keywords, confirmation_status,
      representative_thumbnail_path, embedding, manual_overrides
    ) values (
      v_item.name_original,
      coalesce(nullif(v_item.name_zh_tw, ''), v_item.name_original),
      v_item.name_en,
      v_item.name_vi,
      v_item.brand,
      v_item.model_numbers,
      p_category_id,
      v_item.functions,
      v_item.keywords,
      'human_confirmed',
      v_version.thumbnail_path,
      v_version.embedding,
      jsonb_build_object(
        'name_original', true, 'name_zh_tw', true, 'name_en', true,
        'name_vi', true, 'brand', true, 'model_numbers', true,
        'category_id', true, 'functions', true, 'keywords', true
      )
    ) returning id into v_target_product_id;
  elsif p_action = 'link' then
    if p_product_id is null or not exists (
      select 1 from public.cpf_products
      where id = p_product_id and deleted_at is null
    ) then
      raise exception 'active_product_required';
    end if;
    v_target_product_id := p_product_id;
    if p_category_id is not null then
      update public.cpf_products
      set category_id = p_category_id,
          confirmation_status = 'human_confirmed',
          manual_overrides = manual_overrides || jsonb_build_object('category_id', true),
          updated_at = v_now
      where id = v_target_product_id;
    end if;
  end if;

  if p_action in ('create', 'link') then
    insert into public.cpf_product_documents(product_id, document_id, relation_type)
    values (v_target_product_id, v_document_id, 'source')
    on conflict (product_id, document_id) do nothing;

    if p_supplier_links is not null then
      if jsonb_typeof(p_supplier_links) <> 'array' then
        raise exception 'supplier_links_must_be_array';
      end if;
      delete from public.cpf_product_suppliers
      where product_id = v_target_product_id;
      for v_supplier in select value from jsonb_array_elements(p_supplier_links)
      loop
        if not exists (
          select 1 from public.cpf_suppliers
          where id = (v_supplier->>'id')::uuid and deleted_at is null
        ) then
          raise exception 'supplier_not_found';
        end if;
        v_role := case
          when v_supplier->>'role' in ('manufacturer', 'trader', 'partner', 'unknown')
            then (v_supplier->>'role')::public.cpf_supplier_role
          else 'unknown'::public.cpf_supplier_role
        end;
        insert into public.cpf_product_suppliers(
          product_id, supplier_id, supplier_role, confirmation_status
        ) values (
          v_target_product_id, (v_supplier->>'id')::uuid,
          v_role, 'human_confirmed'
        ) on conflict (product_id, supplier_id, supplier_role) do update
          set confirmation_status = 'human_confirmed';
      end loop;
    end if;
  end if;

  update public.cpf_extracted_items
  set review_status = 'resolved',
      promoted_product_id = v_target_product_id,
      updated_at = v_now
  where id = p_item_id;

  update public.cpf_review_tasks
  set status = 'resolved', resolved_at = v_now, updated_at = v_now,
      payload = payload || jsonb_build_object(
        'extractedItemResolution', p_action,
        'promotedProductId', v_target_product_id,
        'platformActor', p_actor
      )
  where document_id = v_document_id
    and status = 'open'
    and coalesce(payload->>'documentVersionId', '') = v_version.id::text
    and case
      when coalesce(payload->>'itemIndex', '') ~ '^[0-9]+$'
        then (payload->>'itemIndex')::integer
      else -1
    end = v_item.item_index;

  if not exists (
    select 1 from public.cpf_extracted_items
    where document_version_id = v_version.id and review_status = 'open'
  ) and not exists (
    select 1 from public.cpf_review_tasks
    where document_id = v_document_id and status = 'open'
  ) then
    update public.cpf_documents
    set processing_status = 'completed', updated_at = v_now
    where id = v_document_id;
    update public.cpf_processing_jobs
    set status = 'completed', progress = 100,
        message = '人工完成文件與產品主檔審核', updated_at = v_now
    where document_id = v_document_id and status = 'needs_review';
  end if;

  insert into public.cpf_audit_log(action, entity_type, entity_id, details)
  values (
    'cpf_resolve_extracted_item', 'extracted_item', p_item_id::text,
    jsonb_build_object(
      'actor', p_actor, 'action', p_action,
      'documentId', v_document_id, 'productId', v_target_product_id,
      'categoryId', p_category_id, 'supplierLinks', p_supplier_links
    )
  );

  return jsonb_build_object(
    'itemId', p_item_id, 'action', p_action,
    'documentId', v_document_id, 'productId', v_target_product_id
  );
end;
$$;

revoke all on function public.cpf_resolve_extracted_item(
  uuid, text, uuid, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.cpf_resolve_extracted_item(
  uuid, text, uuid, uuid, jsonb, text
) to service_role;
