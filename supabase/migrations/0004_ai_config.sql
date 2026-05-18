-- =============================================================================
-- AI feature configuration on the settings singleton.
-- =============================================================================
--
-- §5.18 of the design doc defines three AI features (complexity
-- estimate, priority recommendation, idea overlap). Each picks its
-- own Bedrock model so an admin can promote / demote individual
-- features without affecting the others. Shape:
--
--   {
--     "estimate_model_id":   "global.anthropic.claude-haiku-4-5-...",
--     "prioritize_model_id": "global.anthropic.claude-sonnet-4-6",
--     "overlap_model_id":    "global.anthropic.claude-sonnet-4-6"
--   }
--
-- Settings is a singleton row; the column is jsonb (matching the
-- pattern of every other settings field) and defaults to the seeded
-- model assignment. SettingsRepository.get() merges this onto the
-- defaults defensively, so a hand-edited row missing the key still
-- reads cleanly.

alter table public.settings
  add column if not exists ai_config jsonb not null default jsonb_build_object(
    'estimate_model_id',   'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    'prioritize_model_id', 'global.anthropic.claude-sonnet-4-6',
    'overlap_model_id',    'global.anthropic.claude-sonnet-4-6'
  );
