-- =============================================================================
-- Add "Mentioned" to the notifications type check constraint.
-- =============================================================================
--
-- Fired when a user is @mentioned (by full name) in a task's Comments
-- field or a project's status-update summary. See lib/notifications/mentions.ts
-- for the mention-resolution logic and lib/notifications/service.ts for the
-- notifyMentioned() helper.
--
-- Postgres can't add a value to an inline CHECK constraint without
-- dropping and recreating it. The constraint name follows the default
-- Postgres naming pattern (`notifications_type_check`); this recreates it
-- with the 8th value, preserving the seven from 0001.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'TaskAssigned',
    'TaskDueSoon',
    'TaskOverdue',
    'ProjectBlocked',
    'DependencyBlocked',
    'HealthScoreChanged',
    'IdeaStatusChanged',
    'Mentioned'
  ));
