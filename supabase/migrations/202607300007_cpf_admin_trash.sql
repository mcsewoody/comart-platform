create policy cpf_products_admin_read_deleted on public.cpf_products
for select using (public.cpf_is_admin());

create policy cpf_documents_admin_read_deleted on public.cpf_documents
for select using (public.cpf_is_admin());
