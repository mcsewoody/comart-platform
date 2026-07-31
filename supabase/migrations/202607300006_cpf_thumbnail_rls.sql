drop policy if exists cpf_storage_preview_read on storage.objects;
create policy cpf_storage_preview_read on storage.objects
for select to authenticated using (
  (
    bucket_id in ('cpf_preview', 'cpf_thumbnail')
    and exists (
      select 1
      from public.cpf_document_versions v
      join public.cpf_documents d on d.id = v.document_id
      where (v.preview_path = name or v.thumbnail_path = name)
        and d.deleted_at is null
        and public.cpf_can_read_document(d.id, d.sensitivity)
    )
  )
  or (
    bucket_id = 'cpf_thumbnail'
    and exists (
      select 1
      from public.cpf_products p
      join public.cpf_product_documents pd on pd.product_id = p.id
      join public.cpf_documents d on d.id = pd.document_id
      where p.representative_thumbnail_path = name
        and p.deleted_at is null
        and d.deleted_at is null
        and public.cpf_can_read_document(d.id, d.sensitivity)
    )
  )
);
