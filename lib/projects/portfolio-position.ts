/**
 * Strategic-position bucketing for the Projects table column and
 * Kanban card badges.
 *
 * A project's position is determined by its `priority` and
 * `ai_complexity_score`:
 *
 *                    Low / Med complexity   High / Very High complexity
 *   Critical / High :       Quick Win              Major Bet
 *   Medium / Low    :        Fill-In             Deprioritize
 *
 * Projects without an `ai_complexity_score` (AI hasn't run) or with
 * a non-standard priority extension are bucketed as `unknown` so the
 * UI can render a neutral "—" instead of guessing.
 *
 * Labels come from `settings.portfolio_quadrants` so admins can rename
 * the buckets ("Quick Win" → "Easy Wins") without changing which
 * projects fall into each one.
 */

import type {
  PortfolioQuadrantLabels,
  Priority,
  Project,
} from "@/lib/db/types";

export type PortfolioPositionKey =
  | "quick_win"
  | "major_bet"
  | "fill_in"
  | "deprioritize"
  | "unknown";

export interface PortfolioPosition {
  key: PortfolioPositionKey;
  /** The user-facing label for this bucket from settings, or "—" for unknown. */
  label: string;
  /** Sort weight for the "Quick Win → Major Bet → Fill-In → Deprioritize" order. */
  sortWeight: number;
}

const HIGH_PRIORITIES: Priority[] = ["Critical", "High"];
const HIGH_COMPLEXITIES = new Set(["High", "Very High"]);
const LOW_COMPLEXITIES = new Set(["Low", "Medium"]);

/**
 * Whether the priority is in the "high impact" half of the matrix.
 * Custom priority extensions added via `enum_extensions` aren't
 * recognized — they fall through to the low half rather than being
 * silently treated as high.
 */
function isHighPriority(priority: string): boolean {
  return (HIGH_PRIORITIES as string[]).includes(priority);
}

/** Sort weight per Section 5.6: Quick Win first, Deprioritize last. */
const SORT_WEIGHTS: Record<PortfolioPositionKey, number> = {
  quick_win: 0,
  major_bet: 1,
  fill_in: 2,
  deprioritize: 3,
  unknown: 4,
};

export function computePortfolioPosition(
  project: Pick<Project, "priority" | "ai_complexity_score">,
  labels: PortfolioQuadrantLabels,
): PortfolioPosition {
  const complexity = project.ai_complexity_score;
  // Without a complexity score we can't bucket — say so explicitly
  // rather than guessing.
  if (
    !complexity ||
    (!HIGH_COMPLEXITIES.has(complexity) && !LOW_COMPLEXITIES.has(complexity))
  ) {
    return { key: "unknown", label: "—", sortWeight: SORT_WEIGHTS.unknown };
  }

  const high = isHighPriority(project.priority);
  const complex = HIGH_COMPLEXITIES.has(complexity);

  let key: PortfolioPositionKey;
  if (high && !complex) key = "quick_win";
  else if (high && complex) key = "major_bet";
  else if (!high && !complex) key = "fill_in";
  else key = "deprioritize";

  return {
    key,
    label: labels[key],
    sortWeight: SORT_WEIGHTS[key],
  };
}

/**
 * Tailwind class strings per bucket key. Inline strings (not
 * interpolated) so the Tailwind JIT compiler can see them and keep the
 * rules in production builds.
 */
export const PORTFOLIO_POSITION_BADGE: Record<PortfolioPositionKey, string> = {
  quick_win:
    "bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-300",
  major_bet: "bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-300",
  fill_in: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-300",
  deprioritize: "bg-rose-50 text-rose-900 ring-1 ring-inset ring-rose-300",
  unknown: "bg-white text-gray-400 ring-1 ring-inset ring-gray-200",
};

/**
 * The four "real" buckets in canonical order, used by filter dropdowns
 * and the admin editor. `unknown` is intentionally excluded — it's a
 * fallback state, not a user-selectable bucket.
 */
export const PORTFOLIO_POSITION_KEYS: Exclude<
  PortfolioPositionKey,
  "unknown"
>[] = ["quick_win", "major_bet", "fill_in", "deprioritize"];
