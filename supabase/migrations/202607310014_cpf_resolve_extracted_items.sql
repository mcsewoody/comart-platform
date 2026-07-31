-- Keep document approval and extracted-item review state consistent.

create or replace function public.cpf_resolve_extracted_items_on_completion()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.processing_status = 'completed'
     and old.processing_status is distinct from new.processing_status
     and new.current_version_id is not null then
    update public.cpf_extracted_items
    set review_status = 'resolved', updated_at = now()
    where document_version_id = new.current_version_id
      and review_status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists cpf_resolve_extracted_items_trigger
on public.cpf_documents;
create trigger cpf_resolve_extracted_items_trigger
after update of processing_status on public.cpf_documents
for each row execute function public.cpf_resolve_extracted_items_on_completion();
