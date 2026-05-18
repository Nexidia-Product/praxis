/**
 * Complexity + time estimate for a single project (§5.18.1).
 *
 * Input: the project's description and project_type. Optionally
 * recent history of past projects of the same type (to anchor the
 * model's estimate against actual team velocity), but Phase 1 just
 * uses the description alone — it's the lowest-cost signal.
 *
 * Output: { complexity, time_estimate, rationale }
 *   - complexity:    one of the ComplexityScore enum values
 *   - time_estimate: free-form range string ("3-5 weeks", "1-2 quarters")
 *   - rationale:     1-3 sentences of why; surfaced under the badge
 *
 * The estimate is cached on the project record (project.ai_complexity_score
 * and project.ai_time_estimate) so a quick view of the project
 * doesn't have to re-call Bedrock. Re-running is on-demand via the
 * "Regenerate estimate" button on the project form.
 */

import { SettingsRepository } from "@/lib/db";
import type { ComplexityScore, ProjectType } from "@/lib/db";
import { runJsonConverse } from "./converse";

export interface EstimateInput {
  description: string;
  projectType: ProjectType;
}

export interface EstimateResult {
  complexity: ComplexityScore;
  time_estimate: string;
  rationale: string;
}

const SYSTEM_PROMPT = `You estimate engineering project complexity and rough delivery time for a small product team that runs innovation initiatives. Use these complexity tiers:

- Low: well-trodden patterns, no integration risk, no new tech, days of work.
- Medium: some unknowns or integration work, ~weeks of effort, manageable scope.
- High: meaningful unknowns, new tech, multiple integrations, ~months of effort.
- Very High: significant unknowns, novel approach, cross-team dependencies, quarters of effort.

Be calibrated and skeptical. If the description is thin, pick the tier and time range that reflects the likely scope and call out the thinness in the rationale.`;

const SCHEMA_HINT = `{
  "complexity": "Low" | "Medium" | "High" | "Very High",
  "time_estimate": string,
  "rationale": string
}`;

export async function estimateComplexity(
  input: EstimateInput,
): Promise<EstimateResult> {
  const settings = await SettingsRepository.get();
  const modelId = settings.ai_config.estimate_model_id;

  const user = `Project type: ${input.projectType}

Project description:
${input.description.trim()}

Estimate the complexity tier and a rough time-to-deliver range (e.g. "2-3 weeks", "1-2 quarters"). Keep the rationale to 1-3 sentences.`;

  const { value } = await runJsonConverse<EstimateResult>({
    modelId,
    system: SYSTEM_PROMPT,
    user,
    schemaHint: SCHEMA_HINT,
    maxTokens: 400,
    temperature: 0.2,
  });

  return normalize(value);
}

function normalize(raw: EstimateResult): EstimateResult {
  const validTiers: ComplexityScore[] = ["Low", "Medium", "High", "Very High"];
  const complexity = validTiers.includes(raw.complexity as ComplexityScore)
    ? (raw.complexity as ComplexityScore)
    : "Medium";
  return {
    complexity,
    time_estimate: String(raw.time_estimate ?? "").trim() || "Unknown",
    rationale: String(raw.rationale ?? "").trim(),
  };
}
