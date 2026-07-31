-- Master-data aliases, AI mapping suggestions and service-side hybrid ranking.
-- All objects remain isolated under the cpf_ prefix.

create table if not exists public.cpf_category_aliases (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.cpf_categories(id) on delete cascade,
  alias text not null,
  locale text,
  created_at timestamptz not null default now()
);

create unique index if not exists cpf_category_alias_lower_unique
  on public.cpf_category_aliases (lower(alias));
create unique index if not exists cpf_supplier_alias_lower_unique
  on public.cpf_supplier_aliases (lower(alias));
create unique index if not exists cpf_category_name_lower_unique
  on public.cpf_categories (lower(name_zh_tw)) where deleted_at is null;
create unique index if not exists cpf_supplier_name_lower_unique
  on public.cpf_suppliers (lower(legal_name)) where deleted_at is null;

create table if not exists public.cpf_master_mapping_suggestions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.cpf_products(id) on delete cascade,
  mapping_type text not null check (mapping_type in ('category', 'supplier')),
  category_id uuid references public.cpf_categories(id),
  supplier_id uuid references public.cpf_suppliers(id),
  supplier_role public.cpf_supplier_role,
  confidence numeric not null check (confidence between 0 and 1),
  rationale text not null default '',
  evidence_excerpt text,
  model text,
  prompt_version text,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'dismissed')),
  applied_at timestamptz,
  applied_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mapping_type = 'category' and category_id is not null and supplier_id is null)
    or (mapping_type = 'supplier' and supplier_id is not null and category_id is null)
  )
);

create index if not exists cpf_mapping_suggestions_pending_idx
  on public.cpf_master_mapping_suggestions(mapping_type, confidence desc)
  where status = 'pending';
create unique index if not exists cpf_mapping_suggestion_category_unique
  on public.cpf_master_mapping_suggestions(product_id, category_id)
  where mapping_type = 'category';
create unique index if not exists cpf_mapping_suggestion_supplier_unique
  on public.cpf_master_mapping_suggestions(product_id, supplier_id, supplier_role)
  where mapping_type = 'supplier';

create or replace function public.cpf_merge_category(
  p_source_id uuid,
  p_target_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_source_id = p_target_id then raise exception 'merge_target_same_as_source'; end if;
  if not exists(select 1 from cpf_categories where id = p_source_id and deleted_at is null)
     or not exists(select 1 from cpf_categories where id = p_target_id and deleted_at is null)
  then raise exception 'category_not_found'; end if;

  update cpf_products set category_id = p_target_id where category_id = p_source_id;
  get diagnostics v_count = row_count;
  update cpf_categories set parent_id = p_target_id where parent_id = p_source_id;
  update cpf_master_mapping_suggestions set category_id = p_target_id
    where category_id = p_source_id and not exists (
      select 1 from cpf_master_mapping_suggestions existing
      where existing.product_id = cpf_master_mapping_suggestions.product_id
        and existing.category_id = p_target_id
    );
  delete from cpf_master_mapping_suggestions where category_id = p_source_id;
  insert into cpf_category_aliases(category_id, alias)
    select p_target_id, name_zh_tw from cpf_categories where id = p_source_id
    on conflict do nothing;
  insert into cpf_category_aliases(category_id, alias, locale)
    select p_target_id, alias, locale from cpf_category_aliases where category_id = p_source_id
    on conflict do nothing;
  update cpf_categories set deleted_at = now(), updated_at = now() where id = p_source_id;
  return jsonb_build_object('productsMoved', v_count, 'actor', p_actor);
end;
$$;

create or replace function public.cpf_merge_supplier(
  p_source_id uuid,
  p_target_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_count integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_source_id = p_target_id then raise exception 'merge_target_same_as_source'; end if;
  if not exists(select 1 from cpf_suppliers where id = p_source_id and deleted_at is null)
     or not exists(select 1 from cpf_suppliers where id = p_target_id and deleted_at is null)
  then raise exception 'supplier_not_found'; end if;

  insert into cpf_product_suppliers(
    product_id, supplier_id, supplier_role, confirmation_status, evidence_id
  )
  select product_id, p_target_id, supplier_role, confirmation_status, evidence_id
  from cpf_product_suppliers where supplier_id = p_source_id
  on conflict (product_id, supplier_id, supplier_role) do update
    set confirmation_status = case
      when excluded.confirmation_status = 'human_confirmed'
      then excluded.confirmation_status
      else cpf_product_suppliers.confirmation_status end;
  get diagnostics v_count = row_count;
  delete from cpf_product_suppliers where supplier_id = p_source_id;
  update cpf_quotes set supplier_id = p_target_id where supplier_id = p_source_id;
  update cpf_master_mapping_suggestions set supplier_id = p_target_id
    where supplier_id = p_source_id and not exists (
      select 1 from cpf_master_mapping_suggestions existing
      where existing.product_id = cpf_master_mapping_suggestions.product_id
        and existing.supplier_id = p_target_id
        and existing.supplier_role is not distinct from cpf_master_mapping_suggestions.supplier_role
    );
  delete from cpf_master_mapping_suggestions where supplier_id = p_source_id;
  insert into cpf_supplier_aliases(supplier_id, alias)
    select p_target_id, legal_name from cpf_suppliers where id = p_source_id
    on conflict do nothing;
  insert into cpf_supplier_aliases(supplier_id, alias, locale)
    select p_target_id, alias, locale from cpf_supplier_aliases where supplier_id = p_source_id
    on conflict do nothing;
  update cpf_suppliers set deleted_at = now(), updated_at = now() where id = p_source_id;
  return jsonb_build_object('relationsMoved', v_count, 'actor', p_actor);
end;
$$;

create or replace function public.cpf_apply_mapping_suggestions(
  p_suggestion_ids uuid[],
  p_actor text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.cpf_master_mapping_suggestions%rowtype;
  v_applied integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if coalesce(array_length(p_suggestion_ids, 1), 0) = 0
     or array_length(p_suggestion_ids, 1) > 500
  then raise exception 'suggestion_count_out_of_range'; end if;

  for v_item in select * from cpf_master_mapping_suggestions
    where id = any(p_suggestion_ids) and status = 'pending' for update
  loop
    if v_item.mapping_type = 'category' then
      update cpf_products set category_id = v_item.category_id, updated_at = now()
      where id = v_item.product_id and deleted_at is null;
    else
      insert into cpf_product_suppliers(
        product_id, supplier_id, supplier_role, confirmation_status
      ) values (
        v_item.product_id, v_item.supplier_id,
        coalesce(v_item.supplier_role, 'unknown'), 'human_confirmed'
      ) on conflict (product_id, supplier_id, supplier_role) do update
        set confirmation_status = 'human_confirmed';
    end if;
    update cpf_master_mapping_suggestions
      set status = 'applied', applied_at = now(), applied_by = p_actor, updated_at = now()
      where id = v_item.id;
    v_applied := v_applied + 1;
  end loop;
  return jsonb_build_object('applied', v_applied);
end;
$$;

create or replace function public.cpf_platform_rank_products(
  p_query text,
  p_embedding public.halfvec(3072) default null
)
returns table(product_id uuid, score double precision)
language sql stable security definer set search_path = public, extensions
as $$
  select p.id,
    (case when exists(
      select 1 from unnest(p.model_numbers) model
      where lower(model) = lower(trim(p_query))
    ) then 1000.0 else 0.0 end)
    + case when trim(p_query) = '' then 0.0 else
        ts_rank_cd(p.search_vector, websearch_to_tsquery('simple', p_query)) * 20.0 end
    + case when trim(p_query) = '' then 0.0 else
        extensions.similarity(p.search_text, p_query) * 8.0 end
    + case when p_embedding is null or p.embedding is null then 0.0 else
        (1 - (p.embedding <=> p_embedding)) * 12.0 end as score
  from cpf_products p
  where p.deleted_at is null
    and (trim(p_query) = ''
      or p.search_vector @@ websearch_to_tsquery('simple', p_query)
      or extensions.similarity(p.search_text, p_query) > 0.08
      or exists(select 1 from unnest(p.model_numbers) m where lower(m) = lower(trim(p_query)))
      or (p_embedding is not null and p.embedding is not null));
$$;

create or replace function public.cpf_platform_rank_documents(
  p_query text,
  p_embedding public.halfvec(3072) default null
)
returns table(document_id uuid, score double precision)
language sql stable security definer set search_path = public, extensions
as $$
  select d.id,
    case when trim(p_query) = '' then 0.0 else
      ts_rank_cd(v.search_vector, websearch_to_tsquery('simple', p_query)) * 20.0 end
    + case when trim(p_query) = '' then 0.0 else
      extensions.similarity(concat_ws(' ', d.title, d.source_path), p_query) * 8.0 end
    + case when p_embedding is null or v.embedding is null then 0.0 else
      (1 - (v.embedding <=> p_embedding)) * 12.0 end as score
  from cpf_documents d
  join cpf_document_versions v on v.id = d.current_version_id
  where d.deleted_at is null
    and (trim(p_query) = ''
      or v.search_vector @@ websearch_to_tsquery('simple', p_query)
      or extensions.similarity(concat_ws(' ', d.title, d.source_path), p_query) > 0.08
      or (p_embedding is not null and v.embedding is not null));
$$;

revoke all on function public.cpf_merge_category(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cpf_merge_supplier(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cpf_apply_mapping_suggestions(uuid[], text) from public, anon, authenticated;
revoke all on function public.cpf_platform_rank_products(text, public.halfvec) from public, anon, authenticated;
revoke all on function public.cpf_platform_rank_documents(text, public.halfvec) from public, anon, authenticated;
grant execute on function public.cpf_merge_category(uuid, uuid, text) to service_role;
grant execute on function public.cpf_merge_supplier(uuid, uuid, text) to service_role;
grant execute on function public.cpf_apply_mapping_suggestions(uuid[], text) to service_role;
grant execute on function public.cpf_platform_rank_products(text, public.halfvec) to service_role;
grant execute on function public.cpf_platform_rank_documents(text, public.halfvec) to service_role;

alter table public.cpf_category_aliases enable row level security;
alter table public.cpf_master_mapping_suggestions enable row level security;
