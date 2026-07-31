begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.calculate_camp_legacy(uuid,uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.calculate_camp(uuid,uuid)',
      'EXECUTE'
    ),
  'clients can invoke only the guarded calculation wrapper'
);

insert into public.camps (
  id,
  organization_id,
  name,
  starts_on,
  ends_on,
  timezone,
  status,
  created_by
) values (
  'c9000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Syntetiskt active-only-läger',
  '2026-10-02',
  '2026-10-04',
  'Europe/Stockholm',
  'draft',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.camp_recipe_copies (
  id,
  organization_id,
  camp_id,
  source_recipe_version_id,
  name,
  version_key,
  frozen_snapshot,
  copied_by
)
select
  '92000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'c9000000-0000-0000-0000-000000000001',
  version.id,
  'Syntetiskt active-only-recept',
  'synthetic-active-only-v1',
  '{
    "ingredients":[
      {
        "id":"active-only-standard",
        "name":"Active-only standard",
        "unit":"kg",
        "amount":1,
        "mode":"head",
        "dietary_rule":"standard",
        "dietary_tag_label":null
      },
      {
        "id":"active-only-gluten",
        "name":"Active-only gluten",
        "unit":"kg",
        "amount":1,
        "mode":"head",
        "dietary_rule":"only",
        "dietary_tag_label":"Gluten"
      }
    ]
  }'::jsonb,
  '11111111-1111-1111-1111-111111111111'
from public.recipe_versions as version
where version.organization_id =
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
order by version.id
limit 1;

insert into public.meals (
  id,
  organization_id,
  camp_id,
  camp_recipe_copy_id,
  starts_at,
  meal_type,
  title,
  status
) values (
  '92000000-0000-0000-0000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'c9000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '2026-10-03T10:00:00Z',
  'lunch',
  'Syntetisk active-only-lunch',
  'ready'
);

insert into public.participants (
  id,
  organization_id,
  camp_id,
  display_name,
  lifecycle_status,
  withdrawn_at
) values
  (
    '91000000-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    'Aktiv med aktiv närvaro',
    'active',
    null
  ),
  (
    '91000000-0000-0000-0000-000000000002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    'Återtagen med aktiv historisk närvaro',
    'withdrawn',
    '2026-09-01T10:00:00Z'
  ),
  (
    '91000000-0000-0000-0000-000000000003',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    'Aktiv med supersederad närvaro',
    'active',
    null
  );

insert into public.participant_attendance (
  id,
  organization_id,
  camp_id,
  participant_id,
  starts_at,
  ends_at,
  source,
  active,
  superseded_at
) values
  (
    '92000000-0000-0000-0000-000000000011',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    '2026-10-02T06:00:00Z',
    '2026-10-04T18:00:00Z',
    'local',
    true,
    null
  ),
  (
    '92000000-0000-0000-0000-000000000012',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002',
    '2026-10-02T06:00:00Z',
    '2026-10-04T18:00:00Z',
    'scoutnet',
    true,
    null
  ),
  (
    '92000000-0000-0000-0000-000000000013',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000003',
    '2026-10-02T06:00:00Z',
    '2026-10-04T18:00:00Z',
    'scoutnet',
    false,
    '2026-09-01T10:00:00Z'
  );

insert into public.dietary_tags (
  id,
  organization_id,
  camp_id,
  label
) values (
  '93000000-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'c9000000-0000-0000-0000-000000000001',
  'Gluten'
);

insert into public.participant_dietary_needs (
  id,
  organization_id,
  camp_id,
  participant_id,
  raw_food_note,
  review_status,
  reviewed_by,
  reviewed_at
) values
  (
    '93000000-0000-0000-0000-000000000011',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    'Supersederad syntettagg',
    'resolved',
    '11111111-1111-1111-1111-111111111111',
    '2026-09-01T10:00:00Z'
  ),
  (
    '93000000-0000-0000-0000-000000000012',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002',
    'Aktiv syntettagg',
    'unreviewed',
    null,
    null
  );

insert into public.dietary_need_tags (
  organization_id,
  camp_id,
  dietary_need_id,
  dietary_tag_id,
  active,
  superseded_at
) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000011',
    '93000000-0000-0000-0000-000000000001',
    false,
    '2026-09-01T10:00:00Z'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000012',
    '93000000-0000-0000-0000-000000000001',
    true,
    null
  );

create temporary table active_calculation_revisions (
  first_revision_id uuid,
  second_revision_id uuid
) on commit drop;
insert into active_calculation_revisions default values;
grant select, update on active_calculation_revisions to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

update active_calculation_revisions
set first_revision_id = public.calculate_camp(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'c9000000-0000-0000-0000-000000000001'
);

reset role;

select is(
  (
    select line.exact_amount
    from public.calculation_lines as line
    join active_calculation_revisions as revision
      on revision.first_revision_id = line.calculation_revision_id
    where line.ingredient_name = 'Active-only standard'
  ),
  1.000000::numeric,
  'only the active participant with active attendance contributes initially'
);

select is(
  (
    select count(*)::integer
    from public.calculation_lines as line
    join active_calculation_revisions as revision
      on revision.first_revision_id = line.calculation_revision_id
    where line.ingredient_name = 'Active-only gluten'
  ),
  0,
  'a superseded dietary tag and a withdrawn tagged participant contribute nothing'
);

select is(
  (
    select revision.problem_summary
      ->> 'unreviewed_dietary_needs'
    from public.calculation_revisions as revision
    join active_calculation_revisions as selected
      on selected.first_revision_id = revision.id
  ),
  '0',
  'an unresolved dietary need on a withdrawn participant is excluded'
);

select is(
  (
    select revision.input_digest
    from public.calculation_revisions as revision
    join active_calculation_revisions as selected
      on selected.first_revision_id = revision.id
  ),
  public.camp_input_digest(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001'
  ),
  'the revision uses the same canonical active-only planning digest'
);

update public.participants
set
  lifecycle_status = 'active',
  withdrawn_at = null
where id = '91000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  true
);

update active_calculation_revisions
set second_revision_id = public.calculate_camp(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'c9000000-0000-0000-0000-000000000001'
);

reset role;

select is(
  (
    select line.exact_amount
    from public.calculation_lines as line
    join active_calculation_revisions as revision
      on revision.second_revision_id = line.calculation_revision_id
    where line.ingredient_name = 'Active-only standard'
  ),
  2.000000::numeric,
  'reactivation restores the participant while superseded attendance stays excluded'
);

select is(
  (
    select line.exact_amount
    from public.calculation_lines as line
    join active_calculation_revisions as revision
      on revision.second_revision_id = line.calculation_revision_id
    where line.ingredient_name = 'Active-only gluten'
  ),
  1.000000::numeric,
  'reactivation restores only the participant with an active dietary tag'
);

select is(
  (
    select revision.problem_summary
      ->> 'unreviewed_dietary_needs'
    from public.calculation_revisions as revision
    join active_calculation_revisions as selected
      on selected.second_revision_id = revision.id
  ),
  '1',
  'reactivation restores the unresolved dietary need to calculation metadata'
);

select is(
  (
    select revision.status::text
    from public.calculation_revisions as revision
    join active_calculation_revisions as selected
      on selected.first_revision_id = revision.id
  ),
  'superseded',
  'the guarded second calculation supersedes the prior revision'
);

select is(
  (
    select revision.input_digest
    from public.calculation_revisions as revision
    join active_calculation_revisions as selected
      on selected.second_revision_id = revision.id
  ),
  public.camp_input_digest(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'c9000000-0000-0000-0000-000000000001'
  ),
  'the reactivated revision also matches the canonical current digest'
);

select * from finish();
rollback;
