/**
 * Single gate for all AI features. Defaults to OFF.
 *
 * Enable by setting AI_ENABLED=true alongside the AWS credentials:
 *   - Local dev: in .env.local
 *   - Production (Vercel): as project environment variables
 *
 * Bedrock auth uses long-lived IAM-user access keys
 * (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY), which don't expire and
 * so work fine on Vercel — unlike the earlier IAM Identity Center /
 * SSO setup, which needed `aws sso login` refresh and couldn't run
 * there. AI is therefore viable in production now; it stays OFF only
 * where AI_ENABLED is unset.
 *
 * Every AI entry point (API route handler, server action, lib
 * function that invokes Bedrock) MUST start with `assertAiEnabled()`
 * so a misconfigured environment is a hard block, not a silent
 * fallback to a broken credential call.
 */

export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED === "true";
}

export class AiDisabledError extends Error {
  constructor() {
    super(
      "AI features are disabled in this environment. Set AI_ENABLED=true (with AWS credentials) in .env.local for local dev, or in the Vercel project env vars for production.",
    );
    this.name = "AiDisabledError";
  }
}

export function assertAiEnabled(): void {
  if (!isAiEnabled()) throw new AiDisabledError();
}
