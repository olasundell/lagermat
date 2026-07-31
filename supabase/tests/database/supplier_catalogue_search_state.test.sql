begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

select has_table(
  'public',
  'supplier_catalogue_search_states',
  'persistent supplier catalogue search state exists'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'supplier_catalogue_search_states'
  ),
  'supplier catalogue search state is protected by RLS'
);

select ok(
  has_table_privilege(
    'authenticated',
    'public.supplier_catalogue_search_states',
    'SELECT'
  ),
  'authenticated members can read organization-scoped search state'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.supplier_catalogue_search_states',
    'INSERT,UPDATE,DELETE'
  ),
  'authenticated members cannot mutate search state directly'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_supplier_catalogue_search_states(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated users can execute the bounded search-state RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.record_supplier_catalogue_search_states(uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ),
  'anonymous users cannot record supplier search state'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.record_supplier_catalogue_search_states(uuid,uuid,uuid,jsonb)'
        ::regprocedure
  ),
  'the search-state RPC is security-definer with an empty search path'
);

select * from finish();
rollback;
