/**
 * Bedrock model discovery.
 *
 * Surfaces every model the team's AWS account can actually invoke,
 * merged from two Bedrock control-plane endpoints:
 *
 *   - ListFoundationModels     → on-demand foundation models.
 *                                 modelId is the bare ID, e.g.
 *                                 "anthropic.claude-sonnet-4-20250514-v1:0".
 *   - ListInferenceProfiles    → system-defined cross-region profiles
 *                                 (Bedrock's "global" / "us." / "eu."
 *                                 prefixes that route across regions
 *                                 for capacity). modelId is the
 *                                 inference profile ID, which the
 *                                 runtime accepts the same way as a
 *                                 bare model ID.
 *
 * The merge produces one flat array so a UI picker can show "all
 * models the account can use" without exposing which list each came
 * from — except via the `type` tag, which lets us style differently
 * if we want.
 *
 * Filtering rules:
 *   - On-demand models are filtered to those that support `TEXT`
 *     input and output AND list "ON_DEMAND" in their inference types.
 *     Models marked PROVISIONED-only (no on-demand throughput) are
 *     excluded since invoking them without a reserved-capacity
 *     commitment errors at runtime.
 *   - Inference profiles are kept as returned; the API only lists
 *     profiles your account/region can use.
 *   - Embedding-only models are filtered out — Praxis AI features
 *     are all generative.
 *   - Results are sorted by provider, then by name.
 */

import {
  GetFoundationModelAvailabilityCommand,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  type FoundationModelSummary,
  type InferenceProfileSummary,
  type ListInferenceProfilesCommandOutput,
} from "@aws-sdk/client-bedrock";

import { bedrockControlClient, bedrockRegion } from "./bedrock";

export type ModelType = "on-demand" | "inference-profile";
/**
 * Where the underlying invocation actually runs:
 *   - "single-region": bare on-demand foundation model, no routing.
 *   - "us-regional":   `us.*` inference profile — routes only within
 *                       us-east-1 / us-east-2 / us-west-2.
 *   - "eu-regional" / "apac-regional": same pattern for those geos.
 *   - "global":         `global.*` profile — routes worldwide; will
 *                       trip a region-whitelist deny policy unless
 *                       every supported region is whitelisted.
 *
 * Surfaced to the UI so an admin can tell apart two profiles that
 * point at the same underlying model but route differently — the
 * label "Anthropic Claude Sonnet 4.5" alone hides the routing
 * scope, and that scope is the difference between a working call
 * and an `AccessDenied` from the deny policy.
 */
export type ModelScope =
  | "single-region"
  | "us-regional"
  | "eu-regional"
  | "apac-regional"
  | "global";

export interface AvailableModel {
  /** Identifier to pass to InvokeModel / Converse. */
  modelId: string;
  /** Display name (provider + short name). */
  name: string;
  /** Vendor: "anthropic", "meta", "amazon", "mistral", etc. */
  provider: string;
  type: ModelType;
  scope: ModelScope;
  /**
   * For on-demand models: the model's home region (always the
   * client's service region here). For inference profiles: the
   * comma-joined list of regions the profile routes across, if
   * the API returned it.
   */
  regionInfo: string;
  /**
   * Free-form context — input modalities, output modalities, etc.
   * Surfaced in the discovery script's table for sanity-checking.
   */
  capabilities: string;
}

export async function listAvailableModels(): Promise<AvailableModel[]> {
  const client = bedrockControlClient();
  const [onDemand, profiles] = await Promise.all([
    listOnDemandModels(client),
    listInferenceProfiles(client),
  ]);
  const merged = [...onDemand, ...profiles];
  merged.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.name.localeCompare(b.name);
  });
  return merged;
}

async function listOnDemandModels(
  client: ReturnType<typeof bedrockControlClient>,
): Promise<AvailableModel[]> {
  const resp = await client.send(new ListFoundationModelsCommand({}));
  const summaries = resp.modelSummaries ?? [];
  const result: AvailableModel[] = [];
  for (const m of summaries) {
    if (!isGenerativeTextModel(m)) continue;
    if (!supportsOnDemand(m)) continue;
    result.push({
      modelId: m.modelId ?? "",
      name: m.modelName ?? m.modelId ?? "(unnamed)",
      provider: m.providerName ?? inferProviderFromId(m.modelId ?? ""),
      type: "on-demand",
      scope: "single-region",
      regionInfo: bedrockRegion,
      capabilities: describeCapabilities(m),
    });
  }
  return result;
}

async function listInferenceProfiles(
  client: ReturnType<typeof bedrockControlClient>,
): Promise<AvailableModel[]> {
  // The Bedrock client paginates inference profiles; the helper here
  // exhausts the cursor so the discovery script doesn't silently
  // drop entries when the account is approved for many profiles.
  const result: AvailableModel[] = [];
  let nextToken: string | undefined = undefined;
  do {
    const resp: ListInferenceProfilesCommandOutput = await client.send(
      new ListInferenceProfilesCommand({ nextToken }),
    );
    for (const p of resp.inferenceProfileSummaries ?? []) {
      result.push(toAvailableFromProfile(p));
    }
    nextToken = resp.nextToken;
  } while (nextToken);
  return result;
}

function toAvailableFromProfile(p: InferenceProfileSummary): AvailableModel {
  // Inference profile IDs use prefixes like "us.", "eu.", "apac.", or
  // "global." in front of the underlying model ID. The provider lives
  // in the underlying model ID, so we infer from the tail rather than
  // from the profile-level fields.
  const id = p.inferenceProfileId ?? "";
  const underlying = stripProfilePrefix(id);
  const provider = inferProviderFromId(underlying);
  const regions =
    (p.models ?? [])
      .map((m) => m.modelArn?.split(":")[3])
      .filter((r): r is string => Boolean(r))
      .filter((r, i, arr) => arr.indexOf(r) === i)
      .join(", ") || bedrockRegion;
  return {
    modelId: id,
    name: p.inferenceProfileName ?? id,
    provider,
    type: "inference-profile",
    scope: scopeFromProfileId(id),
    regionInfo: regions,
    capabilities: p.description ?? "",
  };
}

function scopeFromProfileId(id: string): ModelScope {
  const prefix = id.split(".")[0]?.toLowerCase() ?? "";
  if (prefix === "global") return "global";
  if (prefix === "us") return "us-regional";
  if (prefix === "eu") return "eu-regional";
  if (prefix === "apac") return "apac-regional";
  // Unknown / custom prefix — fall back to "global" because that's
  // the most permissive routing assumption and surfaces the broadest
  // warning in the picker.
  return "global";
}

function isGenerativeTextModel(m: FoundationModelSummary): boolean {
  const inputs = m.inputModalities ?? [];
  const outputs = m.outputModalities ?? [];
  // We want models that take TEXT in and produce TEXT out. Embedding
  // models output EMBEDDING (not TEXT) and are excluded.
  if (!outputs.includes("TEXT")) return false;
  if (!inputs.includes("TEXT")) return false;
  return true;
}

function supportsOnDemand(m: FoundationModelSummary): boolean {
  const types = m.inferenceTypesSupported ?? [];
  return types.includes("ON_DEMAND");
}

function describeCapabilities(m: FoundationModelSummary): string {
  const inputs = (m.inputModalities ?? []).join("+") || "?";
  const outputs = (m.outputModalities ?? []).join("+") || "?";
  return `${inputs}→${outputs}`;
}

function inferProviderFromId(modelId: string): string {
  const head = modelId.split(".")[0];
  return head || "unknown";
}

function stripProfilePrefix(profileId: string): string {
  // System-defined profile IDs look like "us.anthropic.claude-...",
  // "global.anthropic.claude-...", "eu.amazon.nova-...". We split on
  // the first '.', and if what follows still looks like
  // "<provider>.<model>", we return that. Otherwise return the
  // original. (Custom inference profiles are user-named and don't
  // have this shape, but Praxis only surfaces system-defined ones
  // today.)
  const dot = profileId.indexOf(".");
  if (dot < 0) return profileId;
  const tail = profileId.slice(dot + 1);
  if (tail.includes(".")) return tail;
  return profileId;
}

// ---------------------------------------------------------------------------
// Single-model availability lookup (kept here so the import surface
// of lib/ai is one file). Used later when a feature checks "is the
// model the admin picked still reachable" before invoking it.
// ---------------------------------------------------------------------------

export async function isModelAvailable(modelId: string): Promise<boolean> {
  // Inference profiles aren't covered by GetFoundationModelAvailability;
  // the simplest "is this still listed" check is to re-run the merged
  // list and look for the ID. Cheap enough for an admin-side button.
  if (modelId.includes(".") && modelId.split(".").length >= 3) {
    const models = await listAvailableModels();
    return models.some((m) => m.modelId === modelId);
  }
  const client = bedrockControlClient();
  try {
    const resp = await client.send(
      new GetFoundationModelAvailabilityCommand({ modelId }),
    );
    return (resp.entitlementAvailability ?? "") === "AVAILABLE";
  } catch {
    return false;
  }
}
