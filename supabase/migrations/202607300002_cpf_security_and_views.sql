-- Security hardening and read models for the web application.

drop policy if exists cpf_products_read on public.cpf_products;
create policy cpf_products_read on public.cpf_products
for select using (
  deleted_at is null
  and public.cpf_current_user_role() is not null
  and exists (
    select 1
    from public.cpf_product_documents pd
    join public.cpf_documents d on d.id = pd.document_id
    where pd.product_id = cpf_products.id
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);

drop policy if exists cpf_storage_preview_read on storage.objects;
create policy cpf_storage_preview_read on storage.objects
for select to authenticated using (
  bucket_id in ('cpf_preview', 'cpf_thumbnail')
  and exists (
    select 1
    from public.cpf_document_versions v
    join public.cpf_documents d on d.id = v.document_id
    where (v.preview_path = name or v.thumbnail_path = name)
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  )
);

drop function if exists public.cpf_search_products(
  text, jsonb, integer, integer, public.halfvec
);
create function public.cpf_search_products(
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
  suppliers jsonb,
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
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id,
          'name', s.legal_name,
          'role', ps.supplier_role,
          'confirmationStatus', ps.confirmation_status
        ) order by s.legal_name), '[]'::jsonb)
        from public.cpf_product_suppliers ps
        join public.cpf_suppliers s on s.id = ps.supplier_id
        where ps.product_id = p.id and s.deleted_at is null
      ) as suppliers,
      (
        select count(*)
        from public.cpf_product_documents pd
        join public.cpf_documents d on d.id = pd.document_id
        where pd.product_id = p.id
          and d.deleted_at is null
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
    where p.deleted_at is null
      and exists (
        select 1
        from public.cpf_product_documents visible_pd
        join public.cpf_documents visible_d on visible_d.id = visible_pd.document_id
        where visible_pd.product_id = p.id
          and visible_d.deleted_at is null
          and public.cpf_can_read_document(visible_d.id, visible_d.sensitivity)
      )
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
      and (
        not (p_filters ? 'extension')
        or exists (
          select 1
          from public.cpf_product_documents epd
          join public.cpf_documents ed on ed.id = epd.document_id
          join public.cpf_document_versions ev on ev.id = ed.current_version_id
          where epd.product_id = p.id
            and ev.extension = lower(p_filters->>'extension')
            and public.cpf_can_read_document(ed.id, ed.sensitivity)
        )
      )
  )
  select
    r.id, r.name_original, r.name_zh_tw, r.name_en, r.name_vi,
    r.brand, r.model_numbers, r.category_id, r.category_name,
    r.functions, r.keywords, r.suppliers, r.confirmation_status,
    r.representative_thumbnail_path, r.document_count, r.updated_at,
    r.score, count(*) over() as total_count
  from ranked r
  order by r.score desc, r.updated_at desc
  limit greatest(1, least(p_page_size, 100))
  offset greatest(0, (p_page - 1) * p_page_size);
$$;

drop view if exists public.cpf_product_details;
create view public.cpf_product_details
with (security_invoker = true)
as
select
  p.id,
  p.name_original,
  p.name_zh_tw,
  p.name_en,
  p.name_vi,
  p.brand,
  p.model_numbers,
  p.functions,
  p.keywords,
  p.confirmation_status,
  p.representative_thumbnail_path,
  p.updated_at,
  case when c.id is null then null else jsonb_build_object(
    'id', c.id,
    'nameZhTw', c.name_zh_tw,
    'parentId', c.parent_id
  ) end as category,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.legal_name,
      'role', ps.supplier_role,
      'confirmationStatus', ps.confirmation_status
    ) order by s.legal_name), '[]'::jsonb)
    from public.cpf_product_suppliers ps
    join public.cpf_suppliers s on s.id = ps.supplier_id
    where ps.product_id = p.id and s.deleted_at is null
  ) as suppliers,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', sp.id,
      'name', sp.name,
      'valueText', sp.value_text,
      'valueNumber', sp.value_number,
      'unit', sp.unit,
      'sourceText', sp.source_text,
      'confirmationStatus', sp.confirmation_status
    ) order by sp.name), '[]'::jsonb)
    from public.cpf_specifications sp
    where sp.product_id = p.id
  ) as specifications,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'fieldName', e.field_name,
      'sourceLabel', d.title,
      'sourceLocator', e.source_locator,
      'excerpt', e.excerpt,
      'confirmationStatus', e.confirmation_status
    ) order by e.created_at), '[]'::jsonb)
    from public.cpf_evidence e
    join public.cpf_document_versions ev on ev.id = e.document_version_id
    join public.cpf_documents d on d.id = ev.document_id
    where e.product_id = p.id
      and public.cpf_can_read_document(d.id, d.sensitivity)
  ) as evidence,
  (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'title', d.title,
      'extension', v.extension,
      'documentType', d.document_type,
      'sensitivity', d.sensitivity,
      'processingStatus', d.processing_status,
      'sourcePath', d.source_path,
      'version', v.version_number,
      'byteSize', v.byte_size,
      'pageCount', v.page_count,
      'previewUrl', v.preview_path,
      'thumbnailUrl', v.thumbnail_path,
      'updatedAt', d.updated_at
    ) order by d.updated_at desc), '[]'::jsonb)
    from public.cpf_product_documents pd
    join public.cpf_documents d on d.id = pd.document_id
    join public.cpf_document_versions v on v.id = d.current_version_id
    where pd.product_id = p.id
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  ) as documents,
  (
    select count(*)
    from public.cpf_product_documents pd
    join public.cpf_documents d on d.id = pd.document_id
    where pd.product_id = p.id
      and d.deleted_at is null
      and public.cpf_can_read_document(d.id, d.sensitivity)
  ) as document_count,
  (
    select jsonb_build_object(
      'id', q.id,
      'supplierName', coalesce(s.legal_name, ''),
      'currency', q.currency,
      'unitPrice', qt.unit_price,
      'moq', q.moq,
      'leadTimeDays', q.lead_time_days,
      'quoteDate', q.quote_date,
      'incoterm', q.incoterm
    )
    from public.cpf_quotes q
    left join public.cpf_suppliers s on s.id = q.supplier_id
    left join lateral (
      select min(t.unit_price) as unit_price
      from public.cpf_quote_tiers t where t.quote_id = q.id
    ) qt on true
    where q.product_id = p.id
      and q.confirmation_status = 'human_confirmed'
    order by q.quote_date desc nulls last, q.created_at desc
    limit 1
  ) as latest_confirmed_quote
from public.cpf_products p
left join public.cpf_categories c on c.id = p.category_id
where p.deleted_at is null;

grant usage on schema public to authenticated;
grant select on
  public.cpf_profiles,
  public.cpf_categories,
  public.cpf_suppliers,
  public.cpf_supplier_aliases,
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
  public.cpf_duplicate_suggestions,
  public.cpf_processing_jobs,
  public.cpf_document_access_grants,
  public.cpf_product_revisions,
  public.cpf_audit_log,
  public.cpf_search_events,
  public.cpf_document_summaries,
  public.cpf_product_details
to authenticated;

grant insert on public.cpf_search_events to authenticated;
grant insert on storage.objects to authenticated;
grant select on storage.objects to authenticated;

grant execute on function public.cpf_search_products(
  text, jsonb, integer, integer, public.halfvec
) to authenticated;
