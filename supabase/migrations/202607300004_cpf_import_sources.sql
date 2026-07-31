create table if not exists public.cpf_document_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  document_id uuid not null references public.cpf_documents(id) on delete cascade,
  source_kind public.cpf_source_kind not null,
  relative_path text not null,
  last_seen_at timestamptz not null default now(),
  missing_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_kind, relative_path)
);

alter table public.cpf_document_sources enable row level security;
create policy cpf_document_sources_read on public.cpf_document_sources
for select using (
  exists (
    select 1 from public.cpf_documents d
    where d.id = document_id
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);
create policy cpf_document_sources_admin_write on public.cpf_document_sources
for all using (public.cpf_is_admin()) with check (public.cpf_is_admin());
grant select on public.cpf_document_sources to authenticated;

create or replace function public.cpf_register_import(
  p_title text,
  p_relative_path text,
  p_storage_path text,
  p_mime_type text,
  p_extension text,
  p_byte_size bigint,
  p_sha256 text,
  p_sensitivity public.cpf_sensitivity default 'general'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_document_id uuid;
  v_version_id uuid;
  v_job_id uuid;
  v_existing_source public.cpf_document_sources%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if p_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_sha256';
  end if;
  if p_byte_size > 524288000 then
    raise exception 'file_over_storage_limit';
  end if;

  select * into v_existing_source
  from public.cpf_document_sources
  where source_kind = 'onedrive_import'
    and relative_path = p_relative_path;
  if found then
    update public.cpf_document_sources
    set last_seen_at = now(), missing_at = null, archived_at = null
    where id = v_existing_source.id;
    select current_version_id into v_version_id
    from public.cpf_documents where id = v_existing_source.document_id;
    if exists (
      select 1 from public.cpf_document_versions
      where id = v_version_id and sha256 = p_sha256
    ) then
      return jsonb_build_object(
        'documentId', v_existing_source.document_id,
        'versionId', v_version_id,
        'created', false,
        'reason', 'unchanged'
      );
    end if;
  end if;

  select document_id, id into v_document_id, v_version_id
  from public.cpf_document_versions
  where sha256 = p_sha256
  limit 1;
  if found then
    insert into public.cpf_document_sources(
      document_id, source_kind, relative_path
    ) values (
      v_document_id, 'onedrive_import', p_relative_path
    )
    on conflict (source_kind, relative_path) do update
    set document_id = excluded.document_id,
        last_seen_at = now(),
        missing_at = null,
        archived_at = null;
    return jsonb_build_object(
      'documentId', v_document_id,
      'versionId', v_version_id,
      'created', false,
      'reason', 'duplicate_hash'
    );
  end if;

  if v_existing_source.id is not null then
    v_document_id := v_existing_source.document_id;
  else
    insert into public.cpf_documents(
      title, sensitivity, source_kind, source_path
    ) values (
      p_title, p_sensitivity, 'onedrive_import', p_relative_path
    ) returning id into v_document_id;
    insert into public.cpf_document_sources(
      document_id, source_kind, relative_path
    ) values (
      v_document_id, 'onedrive_import', p_relative_path
    );
  end if;

  insert into public.cpf_document_versions(
    document_id, version_number, storage_path, mime_type, extension,
    byte_size, sha256, deep_analysis_eligible
  ) values (
    v_document_id,
    coalesce((
      select max(version_number) + 1
      from public.cpf_document_versions where document_id = v_document_id
    ), 1),
    p_storage_path, p_mime_type, lower(p_extension), p_byte_size, p_sha256,
    p_byte_size <= 104857600
  ) returning id into v_version_id;

  update public.cpf_documents
  set title = p_title,
      source_path = p_relative_path,
      current_version_id = v_version_id,
      processing_status = 'queued',
      deleted_at = null
  where id = v_document_id;

  insert into public.cpf_processing_jobs(document_id, document_version_id)
  values (v_document_id, v_version_id)
  returning id into v_job_id;

  return jsonb_build_object(
    'documentId', v_document_id,
    'versionId', v_version_id,
    'jobId', v_job_id,
    'created', true,
    'reason', 'new_version'
  );
end;
$$;

revoke all on function public.cpf_register_import(
  text, text, text, text, text, bigint, text, public.cpf_sensitivity
) from public, anon, authenticated;
grant execute on function public.cpf_register_import(
  text, text, text, text, text, bigint, text, public.cpf_sensitivity
) to service_role;

create or replace function public.cpf_mark_missing_sources(
  p_seen_before timestamptz
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_count bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  update public.cpf_document_sources
  set missing_at = coalesce(missing_at, now())
  where source_kind = 'onedrive_import'
    and last_seen_at < p_seen_before
    and missing_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cpf_mark_missing_sources(timestamptz)
from public, anon, authenticated;
grant execute on function public.cpf_mark_missing_sources(timestamptz)
to service_role;
