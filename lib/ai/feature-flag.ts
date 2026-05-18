/**
 * Single gate for all AI features. Defaults to OFF.
 *
 * Local dev: set AI_ENABLED=true in .env.local to turn AI on.
 * Production (Vercel): leave AI_ENABLED unset. Bedrock currently
 * requires IAM Identity Center SSO refresh, which Vercel cannot
 * perform — so AI features are local-only until a production
 * credential strategy is decided.
 *
 * Every AI entry point (API route handler, server action, lib
 * function that invokes Bedrock) MUST start with `assertAiEnabled()`
 * so the production path is a hard block, not a silent fallback to
 * a broken credential call.
 */

export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED === "true";
}

export class AiDisabledError extends Error {
  constructor() {
    super(
      "AI features are disabled in this environment. Set AI_ENABLED=true in .env.local for local development.",
    );
    this.name = "AiDisabledError";
  }
}

export function assertAiEnabled(): void {
  if (!isAiEnabled()) throw new AiDisabledError();
}
