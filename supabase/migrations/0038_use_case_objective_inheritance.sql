-- =============================================================================
-- Projects inherit their objectives from the use case they belong to.
-- =============================================================================
--
-- From now on lib/use-cases/service.ts copies a use case's primary and
-- secondary objectives onto every member project whenever the use case is
-- saved, and lib/projects/service.ts rejects edits that diverge from them.
-- This one-time backfill brings projects already assigned to a use case in
-- line, so nothing is stale until the use case is next saved. Use cases
-- without a primary objective (legacy rows) are skipped.

update public.projects p
   set primary_objective = uc.primary_objective,
       secondary_objectives = to_jsonb(uc.secondary_objectives)
  from public.use_cases uc
 where p.project_id = any (uc.member_project_ids)
   and uc.primary_objective is not null
   and (
     p.primary_objective is distinct from uc.primary_objective
     or p.secondary_objectives is distinct from to_jsonb(uc.secondary_objectives)
   );
