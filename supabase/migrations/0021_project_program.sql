-- =============================================================================
-- Project "program" — top-level workstream grouping, separate from
-- application_product (which part of the product) and project_type.
-- =============================================================================
--
-- Splits Innovation portfolio work from Complaints and UI Maintenance work,
-- each of which gets its own Roadmap/Velocity/Work in Progress scoping.
-- Ships with three built-ins (Innovation, Complaints, UI Maintenance);
-- admins can curate more via Admin Console > Project values, same mechanism
-- as application_product.

alter table public.projects
  add column if not exists program text not null default 'Innovation';

-- One-time backfill: projects already tagged Complaints via the
-- application_product stopgap (see the "Complaints Work in Progress" page
-- built before this migration) become program = 'Complaints'.
-- application_product itself is left untouched.
update public.projects set program = 'Complaints'
  where application_product = 'Complaints';
