-- =============================================================================
-- "Phase" renamed to "Stage", and stages became track-scoped.
-- =============================================================================
--
-- Every track's stage list starts with Qualification, then Prioritization,
-- and ends with Productization (see `stagesForTrack` in
-- lib/projects/display.ts); Track A additionally has 12 stages of its own
-- in between. The seven other old fixed-lifecycle phases (Planning, Data
-- Modeling, Application Development, Customer Validation, Deployment
-- Readiness, Handover, Closeout) are retired. Existing projects on one of
-- those are left as-is (not backfilled) — the app's "preserve current
-- value even if off-list" dropdown pattern keeps them visible; they just
-- aren't offered as a new choice.
--
-- Two structural changes need a migration:
--
--   1. The `projects.phase` column is renamed to `stage` (plain text,
--      same as before — no constraint to update).
--   2. Each project's `dependencies` jsonb array is rewritten so
--      `required_phase` becomes `required_stage`, and the dependency
--      type "Blocks Phase" becomes "Blocks Stage" (both key rename and
--      value rename; "Blocks Start" rows are untouched aside from the
--      key rename, since required_stage is null for them either way).

alter table public.projects rename column phase to stage;

update public.projects
set dependencies = (
  select coalesce(
    jsonb_agg(
      (elem - 'required_phase') || jsonb_build_object(
        'required_stage', elem->'required_phase',
        'type',
        case
          when elem->>'type' = 'Blocks Phase' then 'Blocks Stage'
          else elem->>'type'
        end
      )
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(dependencies) as elem
)
where jsonb_array_length(dependencies) > 0;

-- Cosmetic cleanup: drop the now-unused "phase" key from every settings
-- row's enum_extensions blob (it stopped being read the moment "phase"
-- was removed from ExtensibleEnumKey; this just tidies the stored JSON).
update public.settings set enum_extensions = enum_extensions - 'phase';
