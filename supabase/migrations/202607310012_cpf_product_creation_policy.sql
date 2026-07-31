-- CPF extraction policy v2: preserve non-product items without creating fake
-- product masters. This remains isolated under the cpf_ namespace.

create table if not exists public.cpf_extracted_items (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null
    references public.cpf_document_versions(id) on delete cascade,
  item_index integer not null check (item_index >= 0),
  item_kind text not null check (item_kind in (
    'product_variant', 'design_asset', 'component',
    'commercial_line_item', 'product_candidate'
  )),
  family_key text,
  parent_product_name text,
  name_original text not null,
  name_zh_tw text not null default '',
  name_en text not null default '',
  name_vi text not null default '',
  brand text,
  model_numbers text[] not null default '{}',
  functions text[] not null default '{}',
  keywords text[] not null default '{}',
  identity_signals text[] not null default '{}',
  creation_rationale text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric not null check (confidence between 0 and 1),
  review_status public.cpf_review_status not null default 'open',
  promoted_product_id uuid references public.cpf_products(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_version_id, item_index)
);

create index if not exists cpf_extracted_items_review_idx
  on public.cpf_extracted_items(item_kind, review_status, confidence desc);
create index if not exists cpf_extracted_items_family_idx
  on public.cpf_extracted_items(family_key)
  where family_key is not null;

alter table public.cpf_extracted_items enable row level security;

create or replace function public.cpf_apply_ai_extraction_v2(
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
  v_item jsonb;
  v_item_index integer := 0;
  v_filtered_products jsonb := '[]'::jsonb;
  v_filtered_result jsonb;
  v_apply_result jsonb;
  v_document_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  select document_id into v_document_id
  from public.cpf_document_versions
  where id = p_document_version_id;
  if v_document_id is null then raise exception 'version_not_found'; end if;

  if coalesce((
    select (analysis_result->>'applied')::boolean
    from public.cpf_document_versions where id = p_document_version_id
  ), false) then
    return (
      select analysis_result from public.cpf_document_versions
      where id = p_document_version_id
    );
  end if;

  for v_item in
    select value from jsonb_array_elements(
      coalesce(p_result->'products', '[]'::jsonb)
    )
  loop
    if coalesce(v_item->>'record_kind', 'product_candidate') = 'complete_product' then
      v_filtered_products := v_filtered_products || jsonb_build_array(v_item);
    else
      insert into public.cpf_extracted_items(
        document_version_id, item_index, item_kind, family_key,
        parent_product_name, name_original, name_zh_tw, name_en, name_vi,
        brand, model_numbers, functions, keywords, identity_signals,
        creation_rationale, evidence, confidence,
        review_status
      ) values (
        p_document_version_id,
        v_item_index,
        case
          when v_item->>'record_kind' in (
            'product_variant', 'design_asset', 'component',
            'commercial_line_item', 'product_candidate'
          ) then v_item->>'record_kind'
          else 'product_candidate'
        end,
        nullif(v_item->>'family_key', ''),
        nullif(v_item->>'parent_product_name', ''),
        coalesce(nullif(v_item->>'name_original', ''), '未命名項目'),
        coalesce(v_item->>'name_zh_tw', ''),
        coalesce(v_item->>'name_en', ''),
        coalesce(v_item->>'name_vi', ''),
        nullif(v_item->>'brand', ''),
        array(select jsonb_array_elements_text(
          coalesce(v_item->'model_numbers', '[]'::jsonb)
        )),
        array(select jsonb_array_elements_text(
          coalesce(v_item->'functions', '[]'::jsonb)
        )),
        array(select jsonb_array_elements_text(
          coalesce(v_item->'keywords', '[]'::jsonb)
        )),
        array(select jsonb_array_elements_text(
          coalesce(v_item->'identity_signals', '[]'::jsonb)
        )),
        coalesce(v_item->>'creation_rationale', ''),
        coalesce(v_item->'evidence', '[]'::jsonb),
        coalesce((v_item->>'confidence')::numeric, 0),
        case when v_item->>'record_kind' in ('design_asset', 'component')
          then 'resolved'::public.cpf_review_status
          else 'open'::public.cpf_review_status end
      )
      on conflict (document_version_id, item_index) do update set
        item_kind = excluded.item_kind,
        family_key = excluded.family_key,
        parent_product_name = excluded.parent_product_name,
        name_original = excluded.name_original,
        name_zh_tw = excluded.name_zh_tw,
        name_en = excluded.name_en,
        name_vi = excluded.name_vi,
        brand = excluded.brand,
        model_numbers = excluded.model_numbers,
        functions = excluded.functions,
        keywords = excluded.keywords,
        identity_signals = excluded.identity_signals,
        creation_rationale = excluded.creation_rationale,
        evidence = excluded.evidence,
        confidence = excluded.confidence,
        updated_at = now();

      if coalesce(v_item->>'record_kind', 'product_candidate') = 'product_candidate' then
        insert into public.cpf_review_tasks(
          review_type, priority, title, description, document_id, payload
        ) values (
          'field_conflict', 'normal', '產品候選需確認',
          '證據不足以建立獨立產品主檔；可選擇建立產品、連結既有產品或保留為文件項目。',
          v_document_id,
          jsonb_build_object(
            'documentVersionId', p_document_version_id,
            'itemIndex', v_item_index,
            'item', v_item
          )
        );
      end if;
    end if;
    v_item_index := v_item_index + 1;
  end loop;

  v_filtered_result := jsonb_set(
    p_result, '{products}', v_filtered_products, true
  );
  v_apply_result := public.cpf_apply_ai_extraction(
    p_document_version_id,
    v_filtered_result,
    p_embedding,
    p_model,
    p_prompt_version,
    p_usage
  );

  update public.cpf_document_versions
  set analysis_result = p_result || jsonb_build_object(
    'applied', true,
    'productIds', coalesce(v_apply_result->'productIds', '[]'::jsonb),
    'masterProductCount', jsonb_array_length(v_filtered_products),
    'extractedItemCount', v_item_index - jsonb_array_length(v_filtered_products),
    'policyVersion', 'cpf-product-creation-v2',
    'needsReview', coalesce((v_apply_result->>'needsReview')::boolean, false)
  )
  where id = p_document_version_id;

  return (
    select analysis_result from public.cpf_document_versions
    where id = p_document_version_id
  );
end;
$$;

revoke all on function public.cpf_apply_ai_extraction_v2(
  uuid, jsonb, public.halfvec, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.cpf_apply_ai_extraction_v2(
  uuid, jsonb, public.halfvec, text, text, jsonb
) to service_role;
