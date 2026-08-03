-- Only the server-side ICA catalogue adapter may publish products under an
-- ICA account.  Authenticated planners keep the generic import RPCs for real
-- supplier files, but cannot use them to manufacture ICA provenance.

create function public.request_jwt_database_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('role', true), 'none')
  );
$$;

revoke all on function public.request_jwt_database_role()
  from public, anon, authenticated, service_role;

create function public.enforce_ica_supplier_import_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.supplier_accounts as account
    where account.organization_id = new.organization_id
      and account.id = new.supplier_account_id
      and account.provider_key = 'ica'
  ) and not coalesce((
    public.request_jwt_database_role() = 'service_role'
    or (
      public.request_jwt_database_role() is null
      and current_user = 'postgres'
    )
  ), false) then
    raise exception 'ICA catalogue imports require the server catalogue adapter'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ica_supplier_import_authority()
  from public, anon, authenticated, service_role;

create trigger supplier_import_runs_enforce_ica_authority
before insert or update of supplier_account_id, status
on public.supplier_import_runs
for each row execute function public.enforce_ica_supplier_import_authority();

create or replace function public.enforce_ica_supplier_product_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  supplier_provider_key text;
  supplier_location_id text;
begin
  select account.provider_key, account.provider_location_id
  into supplier_provider_key, supplier_location_id
  from public.supplier_accounts as account
  where account.organization_id = new.organization_id
    and account.id = new.supplier_account_id;

  if supplier_provider_key = 'ica' and new.active then
    if not coalesce((
      public.request_jwt_database_role() = 'service_role'
      or (
        public.request_jwt_database_role() is null
        and current_user = 'postgres'
      )
    ), false) then
      raise exception 'ICA supplier products require the server catalogue adapter'
        using errcode = '42501';
    end if;

    if new.product_data_source <> 'import:api'
      or not coalesce(public.ica_supplier_product_has_allowed_provenance(
        new.source_metadata,
        supplier_location_id
      ), false) then
      raise exception
        'ICA supplier products must come from the configured store catalogue'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_ica_supplier_product_provenance()
  from public, anon, authenticated, service_role;

create function public.publish_ica_catalogue_rows_service(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_source text,
  p_refresh_date date,
  p_completed_queries jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_subject text := current_setting('request.jwt.claim.sub', true);
  normalized_source text := lower(trim(coalesce(p_source, '')));
  saved_supplier_account_id uuid;
  import_run_id uuid;
  source_fingerprint text;
  batch_rows jsonb;
  batch_offset integer;
  existing_metadata jsonb;
  incoming_metadata jsonb;
  merged_search_matches jsonb;
  merged_completed_queries jsonb;
  retired_association_products integer := 0;
  deactivated_count integer := 0;
  result jsonb;
begin
  if public.request_jwt_database_role() is distinct from 'service_role' then
    raise exception 'Service role required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organization_memberships as membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_actor_user_id
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership required'
      using errcode = '42501';
  end if;

  select account.id
  into saved_supplier_account_id
  from public.supplier_accounts as account
  where account.organization_id = p_organization_id
    and account.provider_key = 'ica'
    and account.provider_location_id = '1004021'
    and account.active
  -- Serialise the read/merge/publish cycle per ICA account so overlapping
  -- batches from concurrent tabs cannot lose each other's search associations.
  for update;

  if saved_supplier_account_id is null then
    raise exception 'Active ICA Kvantum Sickla account required'
      using errcode = '22023';
  end if;

  if p_refresh_date is null
    or normalized_source not in ('ica_public_webshop', 'ica_local_fixture')
    or jsonb_typeof(p_completed_queries) <> 'array'
    or jsonb_array_length(p_completed_queries) > 10
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) > 1000
    or (
      jsonb_array_length(p_rows) > 0
      and jsonb_array_length(p_completed_queries) = 0
    )
    or pg_column_size(p_rows) > 5000000 then
    raise exception 'ICA catalogue publish payload failed validation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_completed_queries) as completed(value)
    where jsonb_typeof(completed.value) <> 'string'
      or length(trim(completed.value #>> '{}')) not between 2 and 80
  ) or exists (
    select 1
    from jsonb_array_elements_text(p_completed_queries) as completed(value)
    group by lower(trim(completed.value))
    having count(*) > 1
  ) then
    raise exception 'ICA completed queries failed validation'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or jsonb_typeof(item.value -> 'normalized_data') <> 'object'
      or jsonb_typeof(item.value -> 'normalized_data' -> 'metadata')
        <> 'object'
      or item.value -> 'normalized_data' -> 'metadata' ->> 'source'
        is distinct from normalized_source
      or item.value -> 'normalized_data' -> 'metadata' ->> 'store_id'
        is distinct from '1004021'
      or item.value -> 'normalized_data' -> 'packaging_metadata'
        ->> 'normalization_version'
        is distinct from 'ica-public-catalogue-v2'
      or (
        normalized_source = 'ica_local_fixture'
        and item.value -> 'normalized_data' -> 'metadata'
          -> 'synthetic_local_fixture' is distinct from 'true'::jsonb
      )
      or (
        normalized_source = 'ica_public_webshop'
        and item.value -> 'normalized_data' -> 'metadata'
          -> 'synthetic_local_fixture' = 'true'::jsonb
      )
  ) then
    raise exception 'ICA catalogue rows have invalid server provenance'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(
          item.value -> 'normalized_data' -> 'metadata'
            -> 'ica_search_matches'
        ) = 'array'
        then item.value -> 'normalized_data' -> 'metadata'
          -> 'ica_search_matches'
        else '[]'::jsonb
      end
    ) as association(value)
    where jsonb_typeof(association.value) <> 'object'
      or not exists (
        select 1
        from jsonb_array_elements_text(p_completed_queries)
          as completed(value)
        where lower(trim(completed.value)) = lower(trim(
          association.value ->> 'query'
        ))
      )
  ) then
    raise exception 'ICA search associations must belong to completed queries'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) > 0 then
    -- A product may be returned for several ingredient searches split across
    -- different server requests. Preserve all current-day associations instead
    -- of replacing the earlier batch with the later one.
    for row_index in 0..(jsonb_array_length(p_rows) - 1) loop
      -- Keep the catalogue refresh date in trusted server metadata. The
      -- generic importer records source_updated_at as persistence time, which
      -- cannot identify batches from the same logical refresh when a payload
      -- is backdated or crosses midnight.
      incoming_metadata := jsonb_set(
        p_rows -> row_index -> 'normalized_data' -> 'metadata',
        '{ica_refresh_date}',
        to_jsonb(p_refresh_date::text),
        true
      );
      existing_metadata := null;

      select product.source_metadata
      into existing_metadata
      from public.supplier_products as product
      where product.organization_id = p_organization_id
        and product.supplier_account_id = saved_supplier_account_id
        and product.supplier_article_number = trim(
          p_rows -> row_index -> 'normalized_data'
            ->> 'supplier_article_number'
        )
        and product.product_data_source = 'import:api'
        and product.source_metadata ->> 'source' = normalized_source
        and product.source_metadata ->> 'ica_refresh_date'
          = p_refresh_date::text;

      if existing_metadata is not null then
        if jsonb_typeof(existing_metadata -> 'ica_search_matches') = 'array'
          or jsonb_typeof(incoming_metadata -> 'ica_search_matches') = 'array'
        then
          select coalesce(
            jsonb_agg(
              selected.value
              order by selected.rank, selected.query_key
            ),
            '[]'::jsonb
          )
          into merged_search_matches
          from (
            select distinct on (candidate.query_key)
              candidate.value,
              candidate.rank,
              candidate.query_key
            from (
              select
                association.value,
                lower(trim(association.value ->> 'query')) as query_key,
                public.supplier_jsonb_integer(
                  association.value -> 'rank'
                ) as rank,
                association.ordinality
              from jsonb_array_elements(
                coalesce((
                  select jsonb_agg(
                    association.value order by association.ordinality
                  )
                  from jsonb_array_elements(
                    case
                      when jsonb_typeof(
                        existing_metadata -> 'ica_search_matches'
                      ) = 'array'
                      then existing_metadata -> 'ica_search_matches'
                      else '[]'::jsonb
                    end
                  ) with ordinality as association(value, ordinality)
                  where not exists (
                    select 1
                    from jsonb_array_elements_text(p_completed_queries)
                      as completed(value)
                    where lower(trim(completed.value)) = lower(trim(
                      association.value ->> 'query'
                    ))
                  )
                ), '[]'::jsonb)
                || case
                  when jsonb_typeof(
                    incoming_metadata -> 'ica_search_matches'
                  ) = 'array'
                  then incoming_metadata -> 'ica_search_matches'
                  else '[]'::jsonb
                end
              ) with ordinality as association(value, ordinality)
              where jsonb_typeof(association.value) = 'object'
                and length(trim(association.value ->> 'query')) between 1 and 80
                and public.supplier_jsonb_integer(
                  association.value -> 'rank'
                ) is not null
            ) as candidate
            order by
              candidate.query_key,
              candidate.rank,
              candidate.ordinality
          ) as selected;
          incoming_metadata := jsonb_set(
            incoming_metadata,
            '{ica_search_matches}',
            merged_search_matches,
            true
          );
        end if;

        if jsonb_typeof(existing_metadata -> 'ica_completed_searches') = 'array'
          or jsonb_typeof(incoming_metadata -> 'ica_completed_searches') = 'array'
        then
          select coalesce(
            jsonb_agg(
              to_jsonb(selected.query_value)
              order by selected.query_key
            ),
            '[]'::jsonb
          )
          into merged_completed_queries
          from (
            select
              lower(trim(completed.value)) as query_key,
              min(trim(completed.value)) as query_value
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(
                  existing_metadata -> 'ica_completed_searches'
                ) = 'array'
                then existing_metadata -> 'ica_completed_searches'
                else '[]'::jsonb
              end
              || case
                when jsonb_typeof(
                  incoming_metadata -> 'ica_completed_searches'
                ) = 'array'
                then incoming_metadata -> 'ica_completed_searches'
                else '[]'::jsonb
              end
            ) as completed(value)
            where length(trim(completed.value)) between 1 and 80
            group by lower(trim(completed.value))
          ) as selected;
          incoming_metadata := jsonb_set(
            incoming_metadata,
            '{ica_completed_searches}',
            merged_completed_queries,
            true
          );
        end if;
      end if;

      p_rows := jsonb_set(
        p_rows,
        array[row_index::text, 'normalized_data', 'metadata'],
        incoming_metadata,
        false
      );
    end loop;

    source_fingerprint := encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'version', 'ica-server-publish-v1',
            'store_id', '1004021',
            'source', normalized_source,
            'refresh_date', p_refresh_date,
            'rows', p_rows
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    -- The generic import implementation records the human actor through
    -- auth.uid(). Temporarily supply the already re-validated member id while
    -- retaining the signed service_role claim used by both authority triggers.
    perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

    begin
      import_run_id := public.start_supplier_import(
        p_organization_id,
        saved_supplier_account_id,
        null,
        case normalized_source
          when 'ica_local_fixture' then 'ica-kvantum-sickla-local-fixture'
          else 'ica-kvantum-sickla-1004021'
        end,
        'api',
        source_fingerprint
      );

      if exists (
        select 1
        from public.supplier_import_runs as import_run
        where import_run.organization_id = p_organization_id
          and import_run.supplier_account_id = saved_supplier_account_id
          and import_run.id = import_run_id
          and import_run.status = 'staging'
      ) then
        batch_offset := 0;
        while batch_offset < jsonb_array_length(p_rows) loop
          select jsonb_agg(item.value order by item.ordinality)
          into batch_rows
          from jsonb_array_elements(p_rows) with ordinality
            as item(value, ordinality)
          where item.ordinality > batch_offset
            and item.ordinality <= batch_offset + 500;

          perform public.stage_supplier_import_rows(
            p_organization_id,
            saved_supplier_account_id,
            import_run_id,
            batch_rows
          );
          batch_offset := batch_offset + 500;
        end loop;
      end if;

      result := public.finalize_supplier_import(
        p_organization_id,
        saved_supplier_account_id,
        import_run_id
      );
    exception
      when others then
        perform set_config(
          'request.jwt.claim.sub',
          coalesce(original_subject, ''),
          true
        );
        raise;
    end;

    perform set_config(
      'request.jwt.claim.sub',
      coalesce(original_subject, ''),
      true
    );
  else
    result := jsonb_build_object(
      'import_run_id', null,
      'status', 'finalized',
      'staged_rows', 0,
      'imported_rows', 0,
      'invalid_rows', 0
    );
  end if;

  -- Publishing (or reusing an idempotent import) happens before retirement.
  -- A completed query keeps an association only on articles returned for that
  -- query in this payload. Empty results therefore retire every prior match,
  -- while retries keep the already-published association intact.
  if jsonb_array_length(p_completed_queries) > 0 then
    with completed_queries as (
      select distinct lower(trim(completed.value)) as query_key
      from jsonb_array_elements_text(p_completed_queries)
        as completed(value)
    ),
    incoming_query_matches as (
      select distinct
        trim(item.value -> 'normalized_data'
          ->> 'supplier_article_number') as supplier_article_number,
        lower(trim(association.value ->> 'query')) as query_key
      from jsonb_array_elements(p_rows) as item(value)
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(
            item.value -> 'normalized_data' -> 'metadata'
              -> 'ica_search_matches'
          ) = 'array'
          then item.value -> 'normalized_data' -> 'metadata'
            -> 'ica_search_matches'
          else '[]'::jsonb
        end
      ) as association(value)
      join completed_queries as completed
        on completed.query_key = lower(trim(
          association.value ->> 'query'
        ))
    )
    update public.supplier_products as product
    set
      source_metadata = jsonb_set(
        product.source_metadata,
        '{ica_search_matches}',
        coalesce((
          select jsonb_agg(
            association.value order by association.ordinality
          )
          from jsonb_array_elements(
            case
              when jsonb_typeof(
                product.source_metadata -> 'ica_search_matches'
              ) = 'array'
              then product.source_metadata -> 'ica_search_matches'
              else '[]'::jsonb
            end
          ) with ordinality as association(value, ordinality)
          where not (
            exists (
              select 1
              from completed_queries as completed
              where completed.query_key = lower(trim(
                association.value ->> 'query'
              ))
            )
            and not exists (
              select 1
              from incoming_query_matches as incoming
              where incoming.supplier_article_number =
                  product.supplier_article_number
                and incoming.query_key = lower(trim(
                  association.value ->> 'query'
                ))
            )
          )
        ), '[]'::jsonb),
        true
      ),
      updated_at = now()
    where product.organization_id = p_organization_id
      and product.supplier_account_id = saved_supplier_account_id
      and product.active
      and product.product_data_source = 'import:api'
      and product.source_metadata ->> 'source' = normalized_source
      and product.source_metadata ->> 'ica_refresh_date'
        = p_refresh_date::text
      and exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(
              product.source_metadata -> 'ica_search_matches'
            ) = 'array'
            then product.source_metadata -> 'ica_search_matches'
            else '[]'::jsonb
          end
        ) as association(value)
        join completed_queries as completed
          on completed.query_key = lower(trim(
            association.value ->> 'query'
          ))
        where not exists (
          select 1
          from incoming_query_matches as incoming
          where incoming.supplier_article_number =
              product.supplier_article_number
            and incoming.query_key = completed.query_key
        )
      );

    get diagnostics retired_association_products = row_count;
  end if;

  update public.supplier_products as product
  set
    active = false,
    updated_at = now()
  where product.organization_id = p_organization_id
    and product.supplier_account_id = saved_supplier_account_id
    and product.active
    and product.product_data_source = 'import:api'
    and product.source_metadata ->> 'source'
      in ('ica_public_webshop', 'ica_local_fixture')
    and product.source_metadata ->> 'source' <> normalized_source;

  get diagnostics deactivated_count = row_count;

  if deactivated_count > 0 then
    insert into public.audit_events (
      organization_id,
      actor_user_id,
      event_type,
      entity_type,
      entity_id,
      payload
    ) values (
      p_organization_id,
      p_actor_user_id,
      'supplier_catalogue_ica_source_switched',
      'supplier_account',
      saved_supplier_account_id::text,
      jsonb_build_object(
        'source', normalized_source,
        'deactivated_products', deactivated_count,
        'refresh_date', p_refresh_date
      )
    );
  end if;

  return result || jsonb_build_object(
    'supplier_account_id', saved_supplier_account_id,
    'source', normalized_source,
    'refresh_date', p_refresh_date,
    'products_with_retired_search_associations',
      retired_association_products
  );
end;
$$;

revoke all on function public.publish_ica_catalogue_rows_service(
  uuid, uuid, text, date, jsonb, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.publish_ica_catalogue_rows_service(
  uuid, uuid, text, date, jsonb, jsonb
) to service_role;
