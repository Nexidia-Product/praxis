/**
 * AWS Bedrock client factories.
 *
 * Credentials: we use the AWS SDK v3 default Node provider chain,
 * which resolves credentials in this order:
 *   1. env vars (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_SESSION_TOKEN)
 *   2. SSO cache (when AWS_PROFILE points at an SSO-configured profile)
 *   3. shared credentials file
 *   4. EC2 / container metadata
 *
 * Today both local dev and production (Vercel) authenticate with
 * long-lived IAM-user access keys set as env vars: AWS_ACCESS_KEY_ID
 * + AWS_SECRET_ACCESS_KEY (no AWS_SESSION_TOKEN — these keys don't
 * expire, so there's nothing to refresh). Being env-var creds they
 * sit first in the chain and take precedence over any AWS_PROFILE, so
 * don't set both. (An earlier setup used IAM Identity Center / SSO via
 * AWS_PROFILE + the SSO cache; that needed `aws sso login` refresh and
 * couldn't run on Vercel, which is why static keys replaced it.)
 *
 * Region note: the SSO profile sets `sso_region` to wherever IAM
 * Identity Center lives for this org, but Bedrock service calls go
 * to wherever the team has model access granted AND the org's
 * region-whitelist policy permits. Those two regions are
 * independent — `sso_region` is only consulted during credential
 * refresh, while the value passed to each client below is the
 * service-call region. We read it from BEDROCK_REGION (with a
 * fallback to AWS_REGION, then us-east-1) so it can be changed
 * without a code edit when the team learns which region the org's
 * deny-policy actually whitelists.
 *
 * Cross-region inference profiles ("global." / "us." / etc. prefixed
 * model IDs) DO route across regions for capacity, but the SDK
 * still talks to one endpoint — the one we pass here.
 *
 * Every caller MUST `assertAiEnabled()` before constructing a
 * client; the helpers below already do so.
 */

import { BedrockClient } from "@aws-sdk/client-bedrock";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";

import { assertAiEnabled } from "./feature-flag";

/**
 * Region used for every Bedrock service call. Distinct from the
 * SSO region (which sits inside the profile in ~/.aws/config).
 * Read from BEDROCK_REGION env var so an admin can move it without
 * touching code when the org's deny-policy region whitelist
 * changes; falls back to AWS_REGION (the SDK's standard region
 * env) and then to us-east-1 (where IAM Identity Center most
 * commonly lives, and a common whitelist default).
 */
const BEDROCK_REGION =
  process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "us-east-1";

/**
 * Returns the credential provider used for both clients. Centralized
 * so a future swap (e.g. an explicit `fromSSO({ profile: "bedrock" })`
 * if we ever want to refuse to fall back to anything else) only
 * touches one function.
 */
function credentials() {
  return fromNodeProviderChain();
}

/**
 * Control-plane client. Used for ListFoundationModels and
 * ListInferenceProfiles — i.e. anything that enumerates *what's
 * available*, not anything that runs a prompt.
 */
export function bedrockControlClient(): BedrockClient {
  assertAiEnabled();
  return new BedrockClient({
    region: BEDROCK_REGION,
    credentials: credentials(),
  });
}

/**
 * Runtime client. Used for Converse / InvokeModel — anything that
 * actually executes a prompt against a model.
 */
export function bedrockRuntimeClient(): BedrockRuntimeClient {
  assertAiEnabled();
  return new BedrockRuntimeClient({
    region: BEDROCK_REGION,
    credentials: credentials(),
  });
}

/** Service region every Bedrock call targets (independent of SSO region). */
export const bedrockRegion = BEDROCK_REGION;
