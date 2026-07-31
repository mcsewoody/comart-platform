-- Child records must inherit the visibility of their product/document.

drop policy if exists cpf_product_suppliers_read on public.cpf_product_suppliers;
create policy cpf_product_suppliers_read on public.cpf_product_suppliers
for select using (
  exists (
    select 1
    from public.cpf_product_documents pd
    join public.cpf_documents d on d.id = pd.document_id
    where pd.product_id = cpf_product_suppliers.product_id
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);

drop policy if exists cpf_specs_read on public.cpf_specifications;
create policy cpf_specs_read on public.cpf_specifications
for select using (
  exists (
    select 1
    from public.cpf_product_documents pd
    join public.cpf_documents d on d.id = pd.document_id
    where pd.product_id = cpf_specifications.product_id
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);

drop policy if exists cpf_quotes_read on public.cpf_quotes;
create policy cpf_quotes_read on public.cpf_quotes
for select using (
  public.cpf_current_user_role() in ('editor', 'admin')
  and exists (
    select 1
    from public.cpf_document_versions v
    join public.cpf_documents d on d.id = v.document_id
    where v.id = cpf_quotes.document_version_id
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);

drop policy if exists cpf_quote_tiers_read on public.cpf_quote_tiers;
create policy cpf_quote_tiers_read on public.cpf_quote_tiers
for select using (
  exists (
    select 1
    from public.cpf_quotes q
    join public.cpf_document_versions v on v.id = q.document_version_id
    join public.cpf_documents d on d.id = v.document_id
    where q.id = cpf_quote_tiers.quote_id
      and public.cpf_current_user_role() in ('editor', 'admin')
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);

drop policy if exists cpf_product_tags_read on public.cpf_product_tags;
create policy cpf_product_tags_read on public.cpf_product_tags
for select using (
  exists (
    select 1
    from public.cpf_product_documents pd
    join public.cpf_documents d on d.id = pd.document_id
    where pd.product_id = cpf_product_tags.product_id
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);

grant insert, update on
  public.cpf_products,
  public.cpf_documents,
  public.cpf_document_versions,
  public.cpf_product_documents,
  public.cpf_product_suppliers,
  public.cpf_specifications,
  public.cpf_quotes,
  public.cpf_quote_tiers,
  public.cpf_evidence,
  public.cpf_tags,
  public.cpf_product_tags,
  public.cpf_review_tasks,
  public.cpf_duplicate_suggestions
to authenticated;

grant insert, update, delete on
  public.cpf_categories,
  public.cpf_suppliers,
  public.cpf_supplier_aliases,
  public.cpf_document_access_grants
to authenticated;

grant update on public.cpf_profiles to authenticated;
grant delete on public.cpf_products, public.cpf_documents to authenticated;
grant usage, select on all sequences in schema public to authenticated;
