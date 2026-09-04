-- Permanently retire the legacy CPF product-master schema.
-- Product Finder v2 uses only pd_mfg_* / pd_buy_* objects and buckets.

begin;

do $$
declare
  item record;
begin
  for item in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
      and policyname like 'cpf\_%' escape '\'
  loop
    execute format('drop policy if exists %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id like 'cpf\_%' escape '\') then
    raise exception 'Legacy CPF Storage still contains objects; aborting database cleanup';
  end if;
end
$$;

do $$
declare
  item record;
begin
  for item in
    select n.nspname as schema_name, c.relname as object_name, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'cpf\_%' escape '\'
      and c.relkind in ('v', 'm')
  loop
    if item.relkind = 'm' then
      execute format('drop materialized view %I.%I cascade', item.schema_name, item.object_name);
    else
      execute format('drop view %I.%I cascade', item.schema_name, item.object_name);
    end if;
  end loop;
end
$$;

do $$
declare
  statement text;
begin
  select 'drop table ' || string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by c.relname) || ' cascade'
  into statement
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname like 'cpf\_%' escape '\'
    and c.relkind in ('r', 'p', 'f');

  if statement is not null then execute statement; end if;
end
$$;

do $$
declare
  item record;
begin
  for item in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'cpf\_%' escape '\'
  loop
    execute format('drop routine %s cascade', item.signature);
  end loop;
end
$$;

do $$
declare
  item record;
begin
  for item in
    select n.nspname as schema_name, c.relname as object_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'cpf\_%' escape '\'
      and c.relkind = 'S'
  loop
    execute format('drop sequence %I.%I cascade', item.schema_name, item.object_name);
  end loop;
end
$$;

do $$
declare
  item record;
begin
  for item in
    select n.nspname as schema_name, t.typname as type_name
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname like 'cpf\_%' escape '\'
      and t.typtype in ('e', 'd')
  loop
    execute format('drop type %I.%I cascade', item.schema_name, item.type_name);
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'cpf\_%' escape '\'
  ) or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'cpf\_%' escape '\'
  ) or exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname like 'cpf\_%' escape '\'
      and t.typtype in ('e', 'd')
  ) or exists (
    select 1 from storage.buckets where id like 'cpf\_%' escape '\'
  ) or exists (
    select 1 from storage.objects where bucket_id like 'cpf\_%' escape '\'
  ) then
    raise exception 'Legacy CPF objects remain after cleanup';
  end if;
end
$$;

commit;
