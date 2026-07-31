-- COMART Product Finder
-- All application objects are isolated with the cpf_ prefix because this
-- migration is designed to share an existing Supabase project safely.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
-- KMS already has pgvector installed in public. Keep that placement so this
-- migration never attempts to relocate or replace the existing extension.
create extension if not exists vector with schema public;
set search_path = public, extensions;

do $$ begin
  create type public.cpf_user_role as enum ('viewer', 'editor', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_sensitivity as enum ('general', 'commercial', 'highly_confidential');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_confirmation_status as enum (
    'human_confirmed', 'ai_high_confidence', 'needs_review', 'conflict'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_processing_status as enum (
    'queued', 'converting', 'analyzing', 'needs_review', 'completed', 'failed'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_document_type as enum (
    'product', 'quote', 'test_certification', 'meeting_project',
    'supplier', 'contract_commercial', 'other'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_source_kind as enum ('onedrive_import', 'web_upload');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_review_type as enum (
    'field_conflict', 'product_split', 'supplier', 'duplicate'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_review_status as enum ('open', 'resolved', 'dismissed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cpf_supplier_role as enum (
    'manufacturer', 'trader', 'partner', 'unknown'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.cpf_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (lower(email) like '%@comart.com.tw'),
  display_name text not null,
  role public.cpf_user_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.cpf_categories(id),
  name_zh_tw text not null,
  name_en text,
  name_vi text,
  slug text not null unique,
  sort_order integer not null default 0,
  approved_by uuid references public.cpf_profiles(id),
  approved_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_suppliers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  name_zh_tw text,
  name_en text,
  name_vi text,
  country_code text check (country_code is null or char_length(country_code) = 2),
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.cpf_suppliers(id) on delete cascade,
  alias text not null,
  locale text,
  unique (supplier_id, alias)
);

create table if not exists public.cpf_products (
  id uuid primary key default gen_random_uuid(),
  name_original text not null,
  name_zh_tw text not null,
  name_en text not null default '',
  name_vi text not null default '',
  brand text,
  model_numbers text[] not null default '{}',
  category_id uuid references public.cpf_categories(id),
  functions text[] not null default '{}',
  keywords text[] not null default '{}',
  confirmation_status public.cpf_confirmation_status not null default 'needs_review',
  representative_thumbnail_path text,
  manual_overrides jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(search_text, ''))
  ) stored,
  embedding public.halfvec(3072),
  deleted_at timestamptz,
  deleted_by uuid references public.cpf_profiles(id),
  created_by uuid references public.cpf_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_type public.cpf_document_type not null default 'other',
  sensitivity public.cpf_sensitivity not null default 'general',
  processing_status public.cpf_processing_status not null default 'queued',
  source_kind public.cpf_source_kind not null,
  source_path text not null,
  current_version_id uuid,
  deleted_at timestamptz,
  deleted_by uuid references public.cpf_profiles(id),
  created_by uuid references public.cpf_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.cpf_documents(id) on delete cascade,
  version_number integer not null,
  storage_path text not null unique,
  mime_type text not null,
  extension text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null unique check (sha256 ~ '^[a-f0-9]{64}$'),
  page_count integer check (page_count is null or page_count >= 0),
  deep_analysis_eligible boolean not null default true,
  extracted_text text,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(extracted_text, ''))
  ) stored,
  embedding public.halfvec(3072),
  preview_path text,
  thumbnail_path text,
  openai_model text,
  prompt_version text,
  ai_usage jsonb not null default '{}'::jsonb,
  analysis_result jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

alter table public.cpf_documents
  drop constraint if exists cpf_documents_current_version_id_fkey;
alter table public.cpf_documents
  add constraint cpf_documents_current_version_id_fkey
  foreign key (current_version_id) references public.cpf_document_versions(id)
  deferrable initially deferred;

create table if not exists public.cpf_product_documents (
  product_id uuid not null references public.cpf_products(id) on delete cascade,
  document_id uuid not null references public.cpf_documents(id) on delete cascade,
  relation_type text not null default 'source',
  created_at timestamptz not null default now(),
  primary key (product_id, document_id)
);

create table if not exists public.cpf_product_suppliers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.cpf_products(id) on delete cascade,
  supplier_id uuid not null references public.cpf_suppliers(id),
  supplier_role public.cpf_supplier_role not null default 'unknown',
  confirmation_status public.cpf_confirmation_status not null default 'needs_review',
  evidence_id uuid,
  created_at timestamptz not null default now(),
  unique (product_id, supplier_id, supplier_role)
);

create table if not exists public.cpf_specifications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.cpf_products(id) on delete cascade,
  name text not null,
  value_text text,
  value_number numeric,
  unit text,
  source_text text not null,
  confirmation_status public.cpf_confirmation_status not null default 'needs_review',
  manually_confirmed_by uuid references public.cpf_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_quotes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.cpf_products(id) on delete cascade,
  supplier_id uuid references public.cpf_suppliers(id),
  document_version_id uuid not null references public.cpf_document_versions(id),
  quote_date date,
  currency text check (currency is null or char_length(currency) = 3),
  moq integer check (moq is null or moq >= 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  incoterm text,
  confirmation_status public.cpf_confirmation_status not null default 'needs_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_quote_tiers (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.cpf_quotes(id) on delete cascade,
  min_quantity integer not null check (min_quantity > 0),
  max_quantity integer check (max_quantity is null or max_quantity >= min_quantity),
  unit_price numeric not null check (unit_price >= 0),
  unique (quote_id, min_quantity)
);

create table if not exists public.cpf_evidence (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references public.cpf_document_versions(id) on delete cascade,
  product_id uuid references public.cpf_products(id) on delete cascade,
  field_name text not null,
  source_locator text not null,
  excerpt text,
  bounding_box jsonb,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  confirmation_status public.cpf_confirmation_status not null default 'needs_review',
  created_at timestamptz not null default now()
);

alter table public.cpf_product_suppliers
  drop constraint if exists cpf_product_suppliers_evidence_id_fkey;
alter table public.cpf_product_suppliers
  add constraint cpf_product_suppliers_evidence_id_fkey
  foreign key (evidence_id) references public.cpf_evidence(id);

create table if not exists public.cpf_tags (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  tag_type text not null default 'general',
  created_at timestamptz not null default now()
);

create table if not exists public.cpf_product_tags (
  product_id uuid not null references public.cpf_products(id) on delete cascade,
  tag_id uuid not null references public.cpf_tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

create table if not exists public.cpf_review_tasks (
  id uuid primary key default gen_random_uuid(),
  review_type public.cpf_review_type not null,
  status public.cpf_review_status not null default 'open',
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  title text not null,
  description text not null,
  document_id uuid references public.cpf_documents(id) on delete cascade,
  product_id uuid references public.cpf_products(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  assigned_to uuid references public.cpf_profiles(id),
  resolved_by uuid references public.cpf_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_duplicate_suggestions (
  id uuid primary key default gen_random_uuid(),
  product_a_id uuid not null references public.cpf_products(id) on delete cascade,
  product_b_id uuid not null references public.cpf_products(id) on delete cascade,
  similarity numeric not null check (similarity between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  resolution text check (resolution is null or resolution in ('merge', 'variant', 'different')),
  resolved_by uuid references public.cpf_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (product_a_id < product_b_id),
  unique (product_a_id, product_b_id)
);

create table if not exists public.cpf_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.cpf_documents(id) on delete cascade,
  document_version_id uuid not null references public.cpf_document_versions(id) on delete cascade,
  status public.cpf_processing_status not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  message text not null default '',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cpf_document_access_grants (
  document_id uuid not null references public.cpf_documents(id) on delete cascade,
  user_id uuid not null references public.cpf_profiles(id) on delete cascade,
  can_read boolean not null default true,
  granted_by uuid not null references public.cpf_profiles(id),
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create table if not exists public.cpf_product_revisions (
  id bigserial primary key,
  product_id uuid not null references public.cpf_products(id) on delete cascade,
  changed_by uuid references public.cpf_profiles(id),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cpf_audit_log (
  id bigserial primary key,
  actor_id uuid references public.cpf_profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  sensitivity public.cpf_sensitivity,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cpf_search_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.cpf_profiles(id) on delete cascade,
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  result_kind text not null check (result_kind in ('products', 'documents')),
  result_count integer not null default 0,
  clicked_entity_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists cpf_products_search_vector_idx
  on public.cpf_products using gin(search_vector);
create index if not exists cpf_products_search_text_trgm_idx
  on public.cpf_products using gin(search_text extensions.gin_trgm_ops);
create index if not exists cpf_products_embedding_idx
  on public.cpf_products using hnsw (embedding public.halfvec_cosine_ops);
create index if not exists cpf_documents_active_idx
  on public.cpf_documents (updated_at desc) where deleted_at is null;
create index if not exists cpf_document_versions_search_idx
  on public.cpf_document_versions using gin(search_vector);
create index if not exists cpf_document_versions_embedding_idx
  on public.cpf_document_versions using hnsw (embedding public.halfvec_cosine_ops);
create index if not exists cpf_jobs_claim_idx
  on public.cpf_processing_jobs (next_attempt_at, created_at)
  where status in ('queued', 'failed');
create index if not exists cpf_review_open_idx
  on public.cpf_review_tasks (priority, created_at) where status = 'open';
create index if not exists cpf_search_events_expiry_idx
  on public.cpf_search_events (created_at);

create or replace function public.cpf_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.cpf_refresh_product_search_text()
returns trigger language plpgsql as $$
begin
  new.search_text = concat_ws(
    ' ',
    new.name_original,
    new.name_zh_tw,
    new.name_en,
    new.name_vi,
    new.brand,
    array_to_string(new.model_numbers, ' '),
    array_to_string(new.functions, ' '),
    array_to_string(new.keywords, ' ')
  );
  return new;
end;
$$;

create or replace function public.cpf_capture_product_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(old) is distinct from to_jsonb(new) then
    insert into public.cpf_product_revisions(product_id, changed_by, before_data, after_data)
    values (new.id, auth.uid(), to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

drop trigger if exists cpf_products_search_text_trigger on public.cpf_products;
create trigger cpf_products_search_text_trigger
before insert or update of name_original, name_zh_tw, name_en, name_vi, brand,
  model_numbers, functions, keywords
on public.cpf_products for each row execute function public.cpf_refresh_product_search_text();

drop trigger if exists cpf_products_revision_trigger on public.cpf_products;
create trigger cpf_products_revision_trigger
after update on public.cpf_products
for each row execute function public.cpf_capture_product_revision();

do $$
declare
  target regclass;
begin
  foreach target in array array[
    'public.cpf_profiles'::regclass,
    'public.cpf_categories'::regclass,
    'public.cpf_suppliers'::regclass,
    'public.cpf_products'::regclass,
    'public.cpf_documents'::regclass,
    'public.cpf_specifications'::regclass,
    'public.cpf_quotes'::regclass,
    'public.cpf_review_tasks'::regclass,
    'public.cpf_processing_jobs'::regclass
  ] loop
    execute format(
      'drop trigger if exists cpf_touch_updated_at on %s; create trigger cpf_touch_updated_at before update on %s for each row execute function public.cpf_touch_updated_at()',
      target, target
    );
  end loop;
end $$;

create or replace function public.cpf_current_user_role()
returns public.cpf_user_role
language sql stable security definer set search_path = public
as $$
  select role from public.cpf_profiles
  where id = auth.uid() and active = true;
$$;

create or replace function public.cpf_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.cpf_current_user_role() = 'admin', false);
$$;

create or replace function public.cpf_is_editor_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.cpf_current_user_role() in ('editor', 'admin'), false);
$$;

create or replace function public.cpf_can_read_document(
  p_document_id uuid,
  p_sensitivity public.cpf_sensitivity
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when not exists (
      select 1 from public.cpf_profiles p
      where p.id = auth.uid() and p.active = true
    ) then false
    when exists (
      select 1 from public.cpf_document_access_grants g
      where g.document_id = p_document_id
        and g.user_id = auth.uid()
    ) then (
      select g.can_read from public.cpf_document_access_grants g
      where g.document_id = p_document_id
        and g.user_id = auth.uid()
    )
    when p_sensitivity = 'general' then true
    when p_sensitivity = 'commercial' then
      public.cpf_current_user_role() in ('editor', 'admin')
    when p_sensitivity = 'highly_confidential' then
      public.cpf_current_user_role() = 'admin'
    else false
  end;
$$;

create or replace function public.cpf_search_products(
  p_query text default '',
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 30,
  p_embedding public.halfvec(3072) default null
)
returns table (
  id uuid,
  name_original text,
  name_zh_tw text,
  name_en text,
  name_vi text,
  brand text,
  model_numbers text[],
  category_id uuid,
  category_name text,
  functions text[],
  keywords text[],
  confirmation_status public.cpf_confirmation_status,
  thumbnail_path text,
  document_count bigint,
  updated_at timestamptz,
  score double precision,
  total_count bigint
)
language sql stable
as $$
  with ranked as (
    select
      p.*,
      c.name_zh_tw as category_name,
      count(pd.document_id) filter (
        where d.deleted_at is null
          and public.cpf_can_read_document(d.id, d.sensitivity)
      ) as document_count,
      case
        when exists (
          select 1 from unnest(p.model_numbers) model
          where lower(model) = lower(trim(p_query))
        ) then 1000.0
        else 0.0
      end
      + case when trim(p_query) = '' then 0.0 else
          ts_rank_cd(p.search_vector, websearch_to_tsquery('simple', p_query)) * 20.0
        end
      + case when trim(p_query) = '' then 0.0 else
          extensions.similarity(p.search_text, p_query) * 8.0
        end
      + case when p_embedding is null or p.embedding is null then 0.0 else
          (1 - (p.embedding <=> p_embedding)) * 12.0
        end as score
    from public.cpf_products p
    left join public.cpf_categories c on c.id = p.category_id
    left join public.cpf_product_documents pd on pd.product_id = p.id
    left join public.cpf_documents d on d.id = pd.document_id
    where p.deleted_at is null
      and (
        trim(p_query) = ''
        or p.search_vector @@ websearch_to_tsquery('simple', p_query)
        or extensions.similarity(p.search_text, p_query) > 0.08
        or exists (
          select 1 from unnest(p.model_numbers) model
          where lower(model) = lower(trim(p_query))
        )
        or (p_embedding is not null and p.embedding is not null)
      )
      and (
        not (p_filters ? 'categoryId')
        or p.category_id = (p_filters->>'categoryId')::uuid
      )
      and (
        not (p_filters ? 'confirmationStatus')
        or p.confirmation_status::text = p_filters->>'confirmationStatus'
      )
      and (
        not (p_filters ? 'supplierId')
        or exists (
          select 1 from public.cpf_product_suppliers ps
          where ps.product_id = p.id
            and ps.supplier_id = (p_filters->>'supplierId')::uuid
        )
      )
    group by p.id, c.name_zh_tw
  )
  select
    r.id, r.name_original, r.name_zh_tw, r.name_en, r.name_vi,
    r.brand, r.model_numbers, r.category_id, r.category_name,
    r.functions, r.keywords, r.confirmation_status,
    r.representative_thumbnail_path, r.document_count, r.updated_at,
    r.score, count(*) over() as total_count
  from ranked r
  order by r.score desc, r.updated_at desc
  limit greatest(1, least(p_page_size, 100))
  offset greatest(0, (p_page - 1) * p_page_size);
$$;

create or replace function public.cpf_search_documents(
  p_query text default '',
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 30,
  p_embedding public.halfvec(3072) default null
)
returns table (
  id uuid,
  title text,
  extension text,
  document_type public.cpf_document_type,
  sensitivity public.cpf_sensitivity,
  processing_status public.cpf_processing_status,
  source_path text,
  version_number integer,
  byte_size bigint,
  page_count integer,
  preview_path text,
  thumbnail_path text,
  updated_at timestamptz,
  score double precision,
  total_count bigint
)
language sql stable
as $$
  with ranked as (
    select
      d.id, d.title, v.extension, d.document_type, d.sensitivity,
      d.processing_status, d.source_path, v.version_number, v.byte_size,
      v.page_count, v.preview_path, v.thumbnail_path, d.updated_at,
      case when trim(p_query) = '' then 0.0 else
        ts_rank_cd(v.search_vector, websearch_to_tsquery('simple', p_query)) * 20.0
      end
      + case when trim(p_query) = '' then 0.0 else
        extensions.similarity(d.title || ' ' || d.source_path, p_query) * 8.0
      end
      + case when p_embedding is null or v.embedding is null then 0.0 else
        (1 - (v.embedding <=> p_embedding)) * 12.0
      end as score
    from public.cpf_documents d
    join public.cpf_document_versions v on v.id = d.current_version_id
    where d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
      and (
        trim(p_query) = ''
        or v.search_vector @@ websearch_to_tsquery('simple', p_query)
        or extensions.similarity(d.title || ' ' || d.source_path, p_query) > 0.08
        or (p_embedding is not null and v.embedding is not null)
      )
      and (
        not (p_filters ? 'extension')
        or v.extension = lower(p_filters->>'extension')
      )
  )
  select r.*, count(*) over() as total_count
  from ranked r
  order by r.score desc, r.updated_at desc
  limit greatest(1, least(p_page_size, 100))
  offset greatest(0, (p_page - 1) * p_page_size);
$$;

create or replace function public.cpf_register_upload(
  p_title text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_sensitivity public.cpf_sensitivity
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_document_id uuid;
  v_version_id uuid;
begin
  if not public.cpf_is_editor_or_admin() then
    raise exception 'insufficient_permissions';
  end if;
  if p_byte_size > 524288000 then
    raise exception 'file_too_large';
  end if;

  insert into public.cpf_documents(
    title, sensitivity, source_kind, source_path, created_by
  ) values (
    p_title, p_sensitivity, 'web_upload', p_storage_path, auth.uid()
  ) returning id into v_document_id;

  insert into public.cpf_document_versions(
    document_id, version_number, storage_path, mime_type, extension,
    byte_size, sha256, deep_analysis_eligible
  ) values (
    v_document_id, 1, p_storage_path, p_mime_type,
    lower(regexp_replace(p_title, '^.*\.', '')),
    p_byte_size, repeat('0', 64),
    p_byte_size <= 104857600
  ) returning id into v_version_id;

  update public.cpf_documents
  set current_version_id = v_version_id
  where id = v_document_id;

  insert into public.cpf_processing_jobs(document_id, document_version_id)
  values (v_document_id, v_version_id);

  return jsonb_build_object(
    'documentId', v_document_id,
    'versionId', v_version_id,
    'status', 'queued'
  );
end;
$$;

-- The worker replaces the temporary all-zero hash after calculating SHA-256.
-- Concurrent uploads cannot share this placeholder, so make it a partial unique
-- rule only for real hashes.
alter table public.cpf_document_versions
  drop constraint if exists cpf_document_versions_sha256_key;
create unique index if not exists cpf_document_versions_sha256_real_idx
  on public.cpf_document_versions(sha256)
  where sha256 <> repeat('0', 64);

create or replace function public.cpf_claim_processing_jobs(
  p_worker_id text,
  p_limit integer default 3,
  p_lease_minutes integer default 20
)
returns setof public.cpf_processing_jobs
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.cpf_processing_jobs j
    where j.attempts < j.max_attempts
      and j.next_attempt_at <= now()
      and (
        j.status in ('queued', 'failed')
        or (
          j.status in ('converting', 'analyzing')
          and j.lease_expires_at < now()
        )
      )
    order by j.created_at
    for update skip locked
    limit greatest(1, least(p_limit, 10))
  )
  update public.cpf_processing_jobs j
  set
    status = 'converting',
    progress = greatest(j.progress, 5),
    message = 'Background worker claimed job',
    attempts = j.attempts + 1,
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(mins => p_lease_minutes),
    updated_at = now()
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.cpf_update_job(
  p_job_id uuid,
  p_worker_id text,
  p_status public.cpf_processing_status,
  p_progress integer,
  p_message text,
  p_error_code text default null,
  p_error_detail text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.cpf_processing_jobs
  set
    status = p_status,
    progress = greatest(0, least(p_progress, 100)),
    message = p_message,
    error_code = p_error_code,
    error_detail = p_error_detail,
    lease_expires_at = case
      when p_status in ('completed', 'needs_review', 'failed') then null
      else now() + interval '20 minutes'
    end,
    next_attempt_at = case
      when p_status = 'failed' then now() + interval '10 minutes'
      else next_attempt_at
    end,
    updated_at = now()
  where id = p_job_id
    and lease_owner = p_worker_id;
  if not found then
    raise exception 'job_lease_not_owned';
  end if;
end;
$$;

create or replace function public.cpf_log_download(p_document_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sensitivity public.cpf_sensitivity;
begin
  select sensitivity into v_sensitivity
  from public.cpf_documents
  where id = p_document_id
    and deleted_at is null;
  if v_sensitivity is null
    or not public.cpf_can_read_document(p_document_id, v_sensitivity) then
    raise exception 'document_not_accessible';
  end if;
  insert into public.cpf_audit_log(
    actor_id, action, entity_type, entity_id, sensitivity
  ) values (
    auth.uid(), 'download', 'document', p_document_id::text, v_sensitivity
  );
end;
$$;

create or replace function public.cpf_purge_expired_search_events()
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  deleted_count bigint;
begin
  if auth.role() <> 'service_role' and not public.cpf_is_admin() then
    raise exception 'insufficient_permissions';
  end if;
  delete from public.cpf_search_events
  where created_at < now() - interval '90 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace view public.cpf_document_summaries
with (security_invoker = true)
as
select
  d.id, d.title, v.extension, d.document_type, d.sensitivity,
  d.processing_status, d.source_path, v.version_number as version,
  v.byte_size, v.page_count, v.preview_path, v.thumbnail_path, d.updated_at
from public.cpf_documents d
join public.cpf_document_versions v on v.id = d.current_version_id
where d.deleted_at is null;

-- Row level security
alter table public.cpf_profiles enable row level security;
alter table public.cpf_categories enable row level security;
alter table public.cpf_suppliers enable row level security;
alter table public.cpf_supplier_aliases enable row level security;
alter table public.cpf_products enable row level security;
alter table public.cpf_documents enable row level security;
alter table public.cpf_document_versions enable row level security;
alter table public.cpf_product_documents enable row level security;
alter table public.cpf_product_suppliers enable row level security;
alter table public.cpf_specifications enable row level security;
alter table public.cpf_quotes enable row level security;
alter table public.cpf_quote_tiers enable row level security;
alter table public.cpf_evidence enable row level security;
alter table public.cpf_tags enable row level security;
alter table public.cpf_product_tags enable row level security;
alter table public.cpf_review_tasks enable row level security;
alter table public.cpf_duplicate_suggestions enable row level security;
alter table public.cpf_processing_jobs enable row level security;
alter table public.cpf_document_access_grants enable row level security;
alter table public.cpf_product_revisions enable row level security;
alter table public.cpf_audit_log enable row level security;
alter table public.cpf_search_events enable row level security;

create policy cpf_profiles_read_self_or_admin on public.cpf_profiles
for select using (id = auth.uid() or public.cpf_is_admin());
create policy cpf_profiles_admin_all on public.cpf_profiles
for all using (public.cpf_is_admin()) with check (public.cpf_is_admin());

create policy cpf_categories_read_active on public.cpf_categories
for select using (
  deleted_at is null and public.cpf_current_user_role() is not null
);
create policy cpf_categories_admin_write on public.cpf_categories
for all using (public.cpf_is_admin()) with check (public.cpf_is_admin());

create policy cpf_suppliers_read on public.cpf_suppliers
for select using (
  deleted_at is null and public.cpf_current_user_role() is not null
);
create policy cpf_suppliers_editor_write on public.cpf_suppliers
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());
create policy cpf_supplier_aliases_read on public.cpf_supplier_aliases
for select using (public.cpf_current_user_role() is not null);
create policy cpf_supplier_aliases_editor_write on public.cpf_supplier_aliases
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_products_read on public.cpf_products
for select using (
  deleted_at is null and public.cpf_current_user_role() is not null
);
create policy cpf_products_editor_write on public.cpf_products
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_documents_read on public.cpf_documents
for select using (
  deleted_at is null
  and public.cpf_can_read_document(id, sensitivity)
);
create policy cpf_documents_editor_insert on public.cpf_documents
for insert with check (public.cpf_is_editor_or_admin());
create policy cpf_documents_editor_update on public.cpf_documents
for update using (
  public.cpf_is_editor_or_admin()
  and public.cpf_can_read_document(id, sensitivity)
) with check (public.cpf_is_editor_or_admin());
create policy cpf_documents_admin_delete on public.cpf_documents
for delete using (public.cpf_is_admin());

create policy cpf_versions_read on public.cpf_document_versions
for select using (
  exists (
    select 1 from public.cpf_documents d
    where d.id = document_id
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);
create policy cpf_versions_editor_insert on public.cpf_document_versions
for insert with check (public.cpf_is_editor_or_admin());
create policy cpf_versions_editor_update on public.cpf_document_versions
for update using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_product_documents_read on public.cpf_product_documents
for select using (
  exists (
    select 1 from public.cpf_documents d
    where d.id = document_id
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);
create policy cpf_product_documents_editor_write on public.cpf_product_documents
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_product_suppliers_read on public.cpf_product_suppliers
for select using (public.cpf_current_user_role() is not null);
create policy cpf_product_suppliers_editor_write on public.cpf_product_suppliers
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());
create policy cpf_specs_read on public.cpf_specifications
for select using (public.cpf_current_user_role() is not null);
create policy cpf_specs_editor_write on public.cpf_specifications
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_quotes_read on public.cpf_quotes
for select using (public.cpf_current_user_role() in ('editor', 'admin'));
create policy cpf_quotes_editor_write on public.cpf_quotes
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());
create policy cpf_quote_tiers_read on public.cpf_quote_tiers
for select using (public.cpf_current_user_role() in ('editor', 'admin'));
create policy cpf_quote_tiers_editor_write on public.cpf_quote_tiers
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_evidence_read on public.cpf_evidence
for select using (
  exists (
    select 1
    from public.cpf_document_versions v
    join public.cpf_documents d on d.id = v.document_id
    where v.id = document_version_id
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);
create policy cpf_evidence_editor_write on public.cpf_evidence
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_tags_read on public.cpf_tags
for select using (public.cpf_current_user_role() is not null);
create policy cpf_tags_editor_write on public.cpf_tags
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());
create policy cpf_product_tags_read on public.cpf_product_tags
for select using (public.cpf_current_user_role() is not null);
create policy cpf_product_tags_editor_write on public.cpf_product_tags
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());

create policy cpf_review_editor_all on public.cpf_review_tasks
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());
create policy cpf_duplicates_editor_all on public.cpf_duplicate_suggestions
for all using (public.cpf_is_editor_or_admin())
with check (public.cpf_is_editor_or_admin());
create policy cpf_jobs_read on public.cpf_processing_jobs
for select using (public.cpf_is_editor_or_admin());

create policy cpf_access_grants_admin_all on public.cpf_document_access_grants
for all using (public.cpf_is_admin()) with check (public.cpf_is_admin());
create policy cpf_revisions_admin_read on public.cpf_product_revisions
for select using (public.cpf_is_admin());
create policy cpf_audit_admin_read on public.cpf_audit_log
for select using (public.cpf_is_admin());
create policy cpf_search_events_insert_own on public.cpf_search_events
for insert with check (user_id = auth.uid());
create policy cpf_search_events_admin_read on public.cpf_search_events
for select using (public.cpf_is_admin());

-- Private object buckets
insert into storage.buckets(id, name, public, file_size_limit)
values
  ('cpf_source', 'cpf_source', false, 524288000),
  ('cpf_preview', 'cpf_preview', false, 104857600),
  ('cpf_thumbnail', 'cpf_thumbnail', false, 10485760)
on conflict (id) do update set public = false;

create policy cpf_storage_source_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'cpf_source'
  and public.cpf_is_editor_or_admin()
);
create policy cpf_storage_source_read on storage.objects
for select to authenticated
using (
  bucket_id = 'cpf_source'
  and exists (
    select 1
    from public.cpf_document_versions v
    join public.cpf_documents d on d.id = v.document_id
    where v.storage_path = name
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);
create policy cpf_storage_preview_read on storage.objects
for select to authenticated
using (
  bucket_id in ('cpf_preview', 'cpf_thumbnail')
  and public.cpf_current_user_role() is not null
);

revoke all on function public.cpf_claim_processing_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.cpf_update_job(uuid, text, public.cpf_processing_status, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.cpf_claim_processing_jobs(text, integer, integer) to service_role;
grant execute on function public.cpf_update_job(uuid, text, public.cpf_processing_status, integer, text, text, text)
  to service_role;

grant execute on function public.cpf_search_products(text, jsonb, integer, integer, public.halfvec) to authenticated;
grant execute on function public.cpf_search_documents(text, jsonb, integer, integer, public.halfvec) to authenticated;
grant execute on function public.cpf_register_upload(text, text, text, bigint, public.cpf_sensitivity) to authenticated;
grant execute on function public.cpf_log_download(uuid) to authenticated;

comment on table public.cpf_products is 'Canonical product and model-variant records.';
comment on table public.cpf_documents is 'Source documents independent from product records.';
comment on function public.cpf_can_read_document(uuid, public.cpf_sensitivity)
  is 'RLS authority for the viewer/editor/admin and explicit grant matrix.';
