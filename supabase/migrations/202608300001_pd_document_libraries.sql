-- Product Dev document libraries v2.
-- New objects are isolated from the legacy cpf_ namespace.

create table if not exists public.pd_mfg_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  relative_path text not null unique,
  source_factory text,
  category_path text[] not null default '{}',
  document_kind text not null default 'other' check (document_kind in (
    'design_drawing', 'bom', 'cad', 'image', 'presentation', 'document', 'other'
  )),
  extension text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  preview_path text,
  thumbnail_path text,
  keywords text[] not null default '{}',
  summary_zh_tw text not null default '',
  extracted_text text not null default '',
  search_text text not null default '',
  rank_weight numeric not null default 1 check (rank_weight > 0 and rank_weight <= 1),
  is_reference boolean not null default false,
  analysis_status text not null default 'queued' check (analysis_status in (
    'metadata_only', 'queued', 'processing', 'completed', 'failed'
  )),
  analysis_model text,
  ai_usage jsonb not null default '{}'::jsonb,
  source_modified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pd_buy_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  relative_path text not null unique,
  supplier_name text not null,
  product_path text[] not null default '{}',
  document_kind text not null default 'other' check (document_kind in (
    'catalog', 'quotation', 'image', 'presentation', 'document', 'cad', 'other'
  )),
  extension text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  preview_path text,
  thumbnail_path text,
  keywords text[] not null default '{}',
  summary_zh_tw text not null default '',
  extracted_text text not null default '',
  search_text text not null default '',
  rank_weight numeric not null default 1 check (rank_weight > 0 and rank_weight <= 1),
  is_reference boolean not null default false,
  analysis_status text not null default 'queued' check (analysis_status in (
    'metadata_only', 'queued', 'processing', 'completed', 'failed'
  )),
  analysis_model text,
  ai_usage jsonb not null default '{}'::jsonb,
  source_modified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pd_mfg_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.pd_mfg_documents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  worker_id text,
  lease_until timestamptz,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pd_buy_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.pd_buy_documents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  worker_id text,
  lease_until timestamptz,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pd_mfg_documents_search_trgm_idx
  on public.pd_mfg_documents using gin (search_text extensions.gin_trgm_ops);
create index if not exists pd_buy_documents_search_trgm_idx
  on public.pd_buy_documents using gin (search_text extensions.gin_trgm_ops);
create index if not exists pd_mfg_documents_kind_idx
  on public.pd_mfg_documents (document_kind, updated_at desc);
create index if not exists pd_buy_documents_supplier_kind_idx
  on public.pd_buy_documents (supplier_name, document_kind, updated_at desc);
create index if not exists pd_mfg_jobs_queue_idx
  on public.pd_mfg_jobs (created_at) where status in ('queued','failed');
create index if not exists pd_buy_jobs_queue_idx
  on public.pd_buy_jobs (created_at) where status in ('queued','failed');

create or replace function public.pd_mfg_search_documents(
  p_query text default '',
  p_kind text default '',
  p_include_reference boolean default false,
  p_limit integer default 100
)
returns table(document_id uuid, score numeric, match_reason text)
language sql stable security definer set search_path = public, extensions as $$
  with input as (
    select lower(trim(coalesce(p_query, ''))) q
  )
  select d.id,
    round((d.rank_weight * (
      case
        when i.q = '' then 100
        when lower(d.title) = i.q then 1000
        when lower(d.title) like '%' || i.q || '%' then 850
        when lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 700
        when lower(array_to_string(d.category_path, ' ')) like '%' || i.q || '%' then 620
        when lower(coalesce(d.source_factory, '')) like '%' || i.q || '%' then 560
        when lower(d.relative_path) like '%' || i.q || '%' then 520
        when lower(d.extracted_text) like '%' || i.q || '%' then 220
        else greatest(similarity(lower(d.search_text), i.q) * 180, 0)
      end
    ))::numeric, 2) score,
    case
      when i.q = '' then 'recent'
      when lower(d.title) = i.q then 'exact_filename'
      when lower(d.title) like '%' || i.q || '%' then 'filename'
      when lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 'keyword'
      when lower(array_to_string(d.category_path, ' ')) like '%' || i.q || '%' then 'category'
      when lower(coalesce(d.source_factory, '')) like '%' || i.q || '%' then 'factory'
      when lower(d.relative_path) like '%' || i.q || '%' then 'path'
      else 'content'
    end match_reason
  from public.pd_mfg_documents d cross join input i
  where (coalesce(p_kind, '') = '' or d.document_kind = p_kind)
    and (p_include_reference or not d.is_reference)
    and (
      i.q = ''
      or lower(d.search_text) like '%' || i.q || '%'
      or lower(d.search_text) % i.q
    )
  order by score desc, d.updated_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

create or replace function public.pd_claim_jobs(
  p_dataset text,
  p_worker_id text,
  p_limit integer default 5,
  p_lease_minutes integer default 20
)
returns table(id uuid, document_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  target_table regclass;
begin
  if p_dataset = 'mfg' then target_table := 'public.pd_mfg_jobs'::regclass;
  elsif p_dataset = 'buy' then target_table := 'public.pd_buy_jobs'::regclass;
  else raise exception 'invalid dataset';
  end if;

  return query execute format(
    'with claimed as (
       select j.id from %s j
       where (j.status in (''queued'',''failed'') and j.attempts < 3)
          or (j.status = ''processing'' and j.lease_until < now())
       order by j.created_at
       for update skip locked
       limit $1
     )
     update %s j set status = ''processing'', worker_id = $2,
       lease_until = now() + make_interval(mins => $3),
       attempts = j.attempts + 1, error_detail = null, updated_at = now()
     from claimed where j.id = claimed.id
     returning j.id, j.document_id',
    target_table, target_table
  ) using least(greatest(coalesce(p_limit, 5), 1), 50), p_worker_id,
    least(greatest(coalesce(p_lease_minutes, 20), 5), 60);
end;
$$;

create or replace function public.pd_finish_job(
  p_dataset text,
  p_job_id uuid,
  p_worker_id text,
  p_status text,
  p_error_detail text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target_table regclass;
begin
  if p_status not in ('completed','failed') then raise exception 'invalid status'; end if;
  if p_dataset = 'mfg' then target_table := 'public.pd_mfg_jobs'::regclass;
  elsif p_dataset = 'buy' then target_table := 'public.pd_buy_jobs'::regclass;
  else raise exception 'invalid dataset';
  end if;
  execute format(
    'update %s set status=$1, error_detail=$2, lease_until=null, updated_at=now()
     where id=$3 and worker_id=$4', target_table
  ) using p_status, left(p_error_detail, 8000), p_job_id, p_worker_id;
end;
$$;

create or replace function public.pd_buy_search_documents(
  p_query text default '',
  p_supplier text default '',
  p_kind text default '',
  p_include_reference boolean default false,
  p_limit integer default 100
)
returns table(document_id uuid, score numeric, match_reason text)
language sql stable security definer set search_path = public, extensions as $$
  with input as (
    select lower(trim(coalesce(p_query, ''))) q,
           lower(trim(coalesce(p_supplier, ''))) supplier
  )
  select d.id,
    round((d.rank_weight * (
      case
        when i.q = '' and i.supplier = '' then 100
        when i.q <> '' and lower(d.title) = i.q then 1000
        when i.supplier <> '' and lower(d.supplier_name) = i.supplier then 930
        when i.q <> '' and lower(d.title) like '%' || i.q || '%' then 850
        when i.q <> '' and lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 700
        when i.q <> '' and lower(array_to_string(d.product_path, ' ')) like '%' || i.q || '%' then 620
        when i.q <> '' and lower(d.relative_path) like '%' || i.q || '%' then 520
        when i.q <> '' and lower(d.extracted_text) like '%' || i.q || '%' then 220
        else coalesce(greatest(similarity(lower(d.search_text), nullif(i.q, '')), 0), 0) * 180
      end
    ))::numeric, 2) score,
    case
      when i.q = '' and i.supplier = '' then 'recent'
      when i.q <> '' and lower(d.title) = i.q then 'exact_filename'
      when i.supplier <> '' and lower(d.supplier_name) = i.supplier then 'supplier'
      when i.q <> '' and lower(d.title) like '%' || i.q || '%' then 'filename'
      when i.q <> '' and lower(array_to_string(d.keywords, ' ')) like '%' || i.q || '%' then 'keyword'
      when i.q <> '' and lower(array_to_string(d.product_path, ' ')) like '%' || i.q || '%' then 'product_path'
      when i.q <> '' and lower(d.relative_path) like '%' || i.q || '%' then 'path'
      else 'content'
    end match_reason
  from public.pd_buy_documents d cross join input i
  where (coalesce(p_kind, '') = '' or d.document_kind = p_kind)
    and (i.supplier = '' or lower(d.supplier_name) like '%' || i.supplier || '%')
    and (p_include_reference or not d.is_reference)
    and (
      i.q = ''
      or lower(d.search_text) like '%' || i.q || '%'
      or lower(d.search_text) % i.q
    )
  order by score desc, d.updated_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

alter table public.pd_mfg_documents enable row level security;
alter table public.pd_buy_documents enable row level security;
alter table public.pd_mfg_jobs enable row level security;
alter table public.pd_buy_jobs enable row level security;

revoke all on public.pd_mfg_documents, public.pd_buy_documents,
  public.pd_mfg_jobs, public.pd_buy_jobs from public, anon, authenticated;
grant all on public.pd_mfg_documents, public.pd_buy_documents,
  public.pd_mfg_jobs, public.pd_buy_jobs to service_role;
revoke all on function public.pd_mfg_search_documents(text,text,boolean,integer)
  from public, anon, authenticated;
revoke all on function public.pd_buy_search_documents(text,text,text,boolean,integer)
  from public, anon, authenticated;
revoke all on function public.pd_claim_jobs(text,text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.pd_finish_job(text,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.pd_mfg_search_documents(text,text,boolean,integer)
  to service_role;
grant execute on function public.pd_buy_search_documents(text,text,text,boolean,integer)
  to service_role;
grant execute on function public.pd_claim_jobs(text,text,integer,integer)
  to service_role;
grant execute on function public.pd_finish_job(text,uuid,text,text,text)
  to service_role;

insert into storage.buckets(id, name, public, file_size_limit)
values
  ('pd_mfg_source', 'pd_mfg_source', false, 524288000),
  ('pd_mfg_preview', 'pd_mfg_preview', false, 104857600),
  ('pd_mfg_thumbnail', 'pd_mfg_thumbnail', false, 10485760),
  ('pd_buy_source', 'pd_buy_source', false, 524288000),
  ('pd_buy_preview', 'pd_buy_preview', false, 104857600),
  ('pd_buy_thumbnail', 'pd_buy_thumbnail', false, 10485760)
on conflict (id) do update set public = false;
