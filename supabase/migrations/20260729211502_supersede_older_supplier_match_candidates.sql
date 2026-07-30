create function public.supersede_older_supplier_match_candidates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.supplier_match_candidates as existing
  set
    status = 'superseded',
    updated_at = now()
  from (
    select distinct
      inserted.organization_id,
      inserted.supplier_account_id,
      inserted.matcher_version
    from inserted_supplier_match_candidates as inserted
  ) as current_batch
  where existing.organization_id = current_batch.organization_id
    and existing.supplier_account_id =
      current_batch.supplier_account_id
    and existing.matcher_version <> current_batch.matcher_version
    and existing.status in ('safe', 'review');

  return null;
end;
$$;

create trigger supplier_match_candidates_supersede_older_versions
after insert on public.supplier_match_candidates
referencing new table as inserted_supplier_match_candidates
for each statement
execute function public.supersede_older_supplier_match_candidates();

revoke all on function public.supersede_older_supplier_match_candidates()
from public, anon, authenticated, service_role;
