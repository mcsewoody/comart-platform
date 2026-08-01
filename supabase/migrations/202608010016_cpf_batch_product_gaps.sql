-- v1.03: batch-fill missing product master fields without overwriting values.
-- All writes remain isolated to cpf_ objects and require service_role.

create or replace function public.cpf_batch_fill_product_gaps(
  p_product_ids uuid[],
  p_field text,
  p_value jsonb,
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_product_id uuid;
  v_category_id uuid;
  v_supplier_id uuid;
  v_supplier_role public.cpf_supplier_role;
  v_models text[];
  v_updated integer := 0;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if p_field not in ('category', 'supplier', 'model') then
    raise exception 'invalid_batch_field';
  end if;
  if coalesce(array_length(p_product_ids, 1), 0) = 0
     or array_length(p_product_ids, 1) > 200 then
    raise exception 'product_count_must_be_between_1_and_200';
  end if;
  if (select count(*) from unnest(p_product_ids) as requested(id))
     <> (select count(*) from public.cpf_products
         where id = any(p_product_ids) and deleted_at is null) then
    raise exception 'active_products_required';
  end if;

  if p_field = 'category' then
    v_category_id := nullif(p_value->>'categoryId', '')::uuid;
    if v_category_id is null or not exists (
      select 1 from public.cpf_categories
      where id = v_category_id and deleted_at is null
    ) then
      raise exception 'active_category_required';
    end if;
    update public.cpf_products
    set category_id = v_category_id,
        confirmation_status = 'human_confirmed',
        manual_overrides = manual_overrides || jsonb_build_object('category_id', true),
        updated_at = now()
    where id = any(p_product_ids) and category_id is null;
    get diagnostics v_updated = row_count;

  elsif p_field = 'supplier' then
    v_supplier_id := nullif(p_value->>'supplierId', '')::uuid;
    if v_supplier_id is null or not exists (
      select 1 from public.cpf_suppliers
      where id = v_supplier_id and deleted_at is null
    ) then
      raise exception 'active_supplier_required';
    end if;
    v_supplier_role := case
      when p_value->>'role' in ('manufacturer', 'trader', 'partner', 'unknown')
        then (p_value->>'role')::public.cpf_supplier_role
      else 'unknown'::public.cpf_supplier_role
    end;
    foreach v_product_id in array p_product_ids loop
      if not exists (
        select 1 from public.cpf_product_suppliers
        where product_id = v_product_id
      ) then
        insert into public.cpf_product_suppliers(
          product_id, supplier_id, supplier_role, confirmation_status
        ) values (
          v_product_id, v_supplier_id, v_supplier_role, 'human_confirmed'
        );
        update public.cpf_products
        set confirmation_status = 'human_confirmed',
            manual_overrides = manual_overrides || jsonb_build_object('suppliers', true),
            updated_at = now()
        where id = v_product_id;
        v_updated := v_updated + 1;
      end if;
    end loop;

  else
    foreach v_product_id in array p_product_ids loop
      select coalesce(array_agg(trim(value)), '{}'::text[])
      into v_models
      from jsonb_array_elements_text(
        coalesce((p_value->'models')->(v_product_id::text), '[]'::jsonb)
      ) as model(value)
      where trim(value) <> '';
      if coalesce(array_length(v_models, 1), 0) > 0 then
        update public.cpf_products
        set model_numbers = v_models,
            confirmation_status = 'human_confirmed',
            manual_overrides = manual_overrides || jsonb_build_object('model_numbers', true),
            updated_at = now()
        where id = v_product_id
          and coalesce(array_length(model_numbers, 1), 0) = 0;
        get diagnostics v_count = row_count;
        v_updated := v_updated + v_count;
      end if;
    end loop;
  end if;

  insert into public.cpf_audit_log(action, entity_type, details)
  values (
    'cpf_batch_fill_product_gaps', 'product_batch',
    jsonb_build_object(
      'actor', p_actor, 'field', p_field, 'productIds', p_product_ids,
      'value', p_value, 'updated', v_updated
    )
  );

  return jsonb_build_object(
    'requested', array_length(p_product_ids, 1),
    'updated', v_updated,
    'field', p_field
  );
end;
$$;

revoke all on function public.cpf_batch_fill_product_gaps(
  uuid[], text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.cpf_batch_fill_product_gaps(
  uuid[], text, jsonb, text
) to service_role;
