create or replace function public.cpf_update_product_manual(
  p_product_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_product public.cpf_products%rowtype;
  v_override_keys jsonb;
begin
  if not public.cpf_is_editor_or_admin() then
    raise exception 'insufficient_permissions';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) key
    where key not in (
      'nameOriginal', 'nameZhTw', 'nameEn', 'nameVi', 'brand',
      'modelNumbers', 'functions', 'keywords'
    )
  ) then
    raise exception 'unsupported_product_field';
  end if;

  select * into v_product
  from public.cpf_products
  where id = p_product_id
    and deleted_at is null
    and exists (
      select 1
      from public.cpf_product_documents pd
      join public.cpf_documents d on d.id = pd.document_id
      where pd.product_id = cpf_products.id
        and public.cpf_can_read_document(d.id, d.sensitivity)
    )
  for update;
  if not found then raise exception 'product_not_accessible'; end if;

  select coalesce(jsonb_object_agg(key, true), '{}'::jsonb)
  into v_override_keys
  from jsonb_object_keys(p_patch) key;

  update public.cpf_products
  set name_original = case when p_patch ? 'nameOriginal'
        then p_patch->>'nameOriginal' else name_original end,
      name_zh_tw = case when p_patch ? 'nameZhTw'
        then p_patch->>'nameZhTw' else name_zh_tw end,
      name_en = case when p_patch ? 'nameEn'
        then p_patch->>'nameEn' else name_en end,
      name_vi = case when p_patch ? 'nameVi'
        then p_patch->>'nameVi' else name_vi end,
      brand = case when p_patch ? 'brand'
        then nullif(p_patch->>'brand', '') else brand end,
      model_numbers = case when p_patch ? 'modelNumbers'
        then array(select jsonb_array_elements_text(p_patch->'modelNumbers'))
        else model_numbers end,
      functions = case when p_patch ? 'functions'
        then array(select jsonb_array_elements_text(p_patch->'functions'))
        else functions end,
      keywords = case when p_patch ? 'keywords'
        then array(select jsonb_array_elements_text(p_patch->'keywords'))
        else keywords end,
      confirmation_status = 'human_confirmed',
      manual_overrides = manual_overrides || v_override_keys
  where id = p_product_id
  returning * into v_product;

  return to_jsonb(v_product);
end;
$$;

revoke all on function public.cpf_update_product_manual(uuid, jsonb)
from public, anon;
grant execute on function public.cpf_update_product_manual(uuid, jsonb)
to authenticated;
