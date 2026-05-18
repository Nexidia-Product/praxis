/**
 * Discovery CLI for AWS Bedrock model availability.
 *
 * Lists every model the team's account can invoke from the
 * Bedrock service region (us-east-2 today), merged from
 * ListFoundationModels and ListInferenceProfiles. Prints a
 * readable table to stdout grouped by provider, with the model
 * IDs you'd pass to InvokeModel / Converse.
 *
 * Run with:
 *   npm run ai:list-models
 *
 * Prereqs:
 *   - AI_ENABLED=true in .env.local
 *   - AWS_PROFILE=bedrock in .env.local
 *   - An active SSO session for the `bedrock` profile (run
 *     `aws sso login --profile bedrock` if you get a credential
 *     error; the SDK refreshes from the SSO cache automatically
 *     while the session is still valid).
 */

import { bedrockRegion } from "../lib/ai/bedrock";
import { listAvailableModels, type AvailableModel } from "../lib/ai/models";

function formatTable(models: AvailableModel[]): string {
  if (models.length === 0) {
    return "(no models returned — check AWS_PROFILE / region / Bedrock model access in the AWS console)";
  }
  const rows = models.map((m) => ({
    type: m.type,
    provider: m.provider,
    name: m.name,
    modelId: m.modelId,
    region: m.regionInfo,
    io: m.capabilities,
  }));
  const widths = {
    type: Math.max(4, ...rows.map((r) => r.type.length)),
    provider: Math.max(8, ...rows.map((r) => r.provider.length)),
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    modelId: Math.max(7, ...rows.map((r) => r.modelId.length)),
    region: Math.max(6, ...rows.map((r) => r.region.length)),
    io: Math.max(2, ...rows.map((r) => r.io.length)),
  };
  const pad = (s: string, w: number) => s.padEnd(w);
  const header =
    pad("TYPE", widths.type) +
    "  " +
    pad("PROVIDER", widths.provider) +
    "  " +
    pad("NAME", widths.name) +
    "  " +
    pad("MODEL ID", widths.modelId) +
    "  " +
    pad("REGION", widths.region) +
    "  " +
    pad("I/O", widths.io);
  const line = "-".repeat(header.length);
  const body = rows
    .map(
      (r) =>
        pad(r.type, widths.type) +
        "  " +
        pad(r.provider, widths.provider) +
        "  " +
        pad(r.name, widths.name) +
        "  " +
        pad(r.modelId, widths.modelId) +
        "  " +
        pad(r.region, widths.region) +
        "  " +
        pad(r.io, widths.io),
    )
    .join("\n");
  return [header, line, body].join("\n");
}

async function main() {
  if (process.env.AI_ENABLED !== "true") {
    console.error(
      "AI features are disabled. Set AI_ENABLED=true in .env.local and re-run.",
    );
    process.exit(2);
  }
  console.log(
    `Querying Bedrock in region: ${bedrockRegion} ` +
      `(profile: ${process.env.AWS_PROFILE ?? "<default>"})\n`,
  );
  const models = await listAvailableModels();
  console.log(formatTable(models));
  console.log(`\nTotal: ${models.length} model(s).`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed in region ${bedrockRegion}: ${msg}`);
  if (msg.includes("DenyAllOutsideWhitelistedRegion")) {
    console.error(
      "\nThe org's region-whitelist policy denied this call. Check\n" +
        "which regions are allowed in the policy (IAM → Policies →\n" +
        "Policy-DenyAllOutsideWhitelistedRegion → Condition) and set\n" +
        "BEDROCK_REGION in .env.local to one of those regions before\n" +
        "re-running.",
    );
  }
  process.exit(1);
});
