"use client";

/**
 * Velocity Dashboard (Section 5.15) — orchestration component.
 *
 * Owns the filter set and the loading state for the metric fetch.
 * Whenever the filters object changes, a fresh GET to
 * `/api/dashboard/velocity` runs; the resulting `VelocityMetrics` payload
 * feeds the seven chart components.
 *
 * Why a single client component instead of one per chart:
 *
 *   - All charts share the same filter set, so each one fetching its own
 *     metric would be N requests for the same query string.
 *   - The API returns everything in one round trip (Section 5.15
 *     "implementation notes" — caching the composite payload).
 *
 * Filter-state shape: the `VelocityFilters` object is built locally with
 * `range.start` and `range.end` left empty for non-custom ranges; the
 * server resolves them. Custom dates live in their own state slots so
 * they survive a temporary swap to "30 days" and back.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChartCard } from "@/components/velocity/charts";
import {
  AvgTimeToCompletionChart,
  BlockedTimeChart,
  CompletedByQuarterChart,
  EstimatedVsActualChart,
  IdeaConversionChart,
  PhaseCycleTimeChart,
  TaskThroughputChart,
} from "@/components/velocity/charts";
import { VelocityFilterBar } from "@/components/velocity/filter-bar";
import type { UserId, UserRole } from "@/lib/db";
import type {
  VelocityFilters,
  VelocityMetrics,
} from "@/lib/velocity/types";

interface VelocityDashboardProps {
  currentUserId: UserId;
  currentUserRole: UserRole;
}

const DEFAULT_FILTERS: VelocityFilters = {
  range: { kind: "90d", start: null, end: "" },
  project_types: [],
  application_products: [],
  project_leads: [],
  individual_user_id: null,
};

export function VelocityDashboard({
  currentUserId,
  currentUserRole,
}: VelocityDashboardProps) {
  const [filters, setFilters] = useState<VelocityFilters>(DEFAULT_FILTERS);
  // Custom range dates live separately from `filters` so toggling between
  // preset ranges doesn't lose them.
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [metrics, setMetrics] = useState<VelocityMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Track in-flight requests so a stale response can't overwrite a fresher
  // one. Each call gets a sequence number; only the highest-seen response
  // is committed to state.
  const seqRef = useRef(0);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", filters.range.kind);
    if (filters.range.kind === "custom") {
      if (customStart) params.set("start", customStart);
      if (customEnd) params.set("end", customEnd);
    }
    if (filters.project_types.length > 0) {
      params.set("types", filters.project_types.join(","));
    }
    if (filters.application_products.length > 0) {
      params.set("products", filters.application_products.join(","));
    }
    if (filters.project_leads.length > 0) {
      params.set("leads", filters.project_leads.join(","));
    }
    if (filters.individual_user_id) {
      params.set("individual", filters.individual_user_id);
    }
    return params.toString();
  }, [filters, customStart, customEnd]);

  const fetchMetrics = useCallback(
    async (qs: string) => {
      const mySeq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/dashboard/velocity?${qs}`, {
          method: "GET",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed: ${res.status}`);
        }
        const json = (await res.json()) as { metrics: VelocityMetrics };
        // Only commit if no newer request has fired in the meantime.
        if (mySeq === seqRef.current) {
          setMetrics(json.metrics);
        }
      } catch (err) {
        if (mySeq === seqRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load metrics.");
          setMetrics(null);
        }
      } finally {
        if (mySeq === seqRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Skip the initial fetch when the user has selected Custom but not yet
    // entered any dates — the API returns 400 in that case, and there's no
    // point in surfacing that as an error before the user has had a chance
    // to type.
    if (
      filters.range.kind === "custom" &&
      !customStart &&
      !customEnd
    ) {
      setLoading(false);
      return;
    }
    fetchMetrics(queryString);
  }, [queryString, filters.range.kind, customStart, customEnd, fetchMetrics]);

  return (
    <div className="space-y-5">
      <VelocityFilterBar
        value={filters}
        onChange={setFilters}
        options={{
          application_products: metrics?.filter_options.application_products ?? [],
          project_leads: metrics?.filter_options.project_leads ?? [],
        }}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
      />

      {/* Status row: cache hit indicator, loading, error. */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <div>
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
              Loading metrics…
            </span>
          ) : metrics ? (
            <span>
              Computed{" "}
              {new Date(metrics.computed_at).toLocaleString()}{" "}
              {metrics.from_cache ? (
                <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 font-medium text-gray-600">
                  cached
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        {error ? (
          <span className="text-rose-700">Error: {error}</span>
        ) : null}
      </div>

      {metrics?.insufficient_history ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Calibration period</p>
          <p className="mt-1 text-amber-800">
            Fewer than three projects have been completed in this filter set.
            Charts below render the available data, but trend lines and
            averages will become more reliable once more projects complete.
          </p>
        </div>
      ) : null}

      {/* Empty state when we couldn't fetch and have nothing yet. */}
      {!metrics && !loading ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          {error
            ? "Unable to load the dashboard. Adjust filters or try again."
            : filters.range.kind === "custom"
              ? "Enter a start and end date to see metrics for a custom range."
              : "No metrics available."}
        </div>
      ) : null}

      {/* The grid only renders once we have a metrics object so charts
          always see a real payload. Loading state is communicated by the
          status row above. */}
      {metrics ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CompletedByQuarterChart metric={metrics.completed_by_quarter} />
          <AvgTimeToCompletionChart metric={metrics.avg_time_to_completion} />
          <EstimatedVsActualChart metric={metrics.estimated_vs_actual} />
          <TaskThroughputChart metric={metrics.task_throughput} />
          <PhaseCycleTimeChart metric={metrics.phase_cycle_time} />
          <BlockedTimeChart metric={metrics.blocked_time} />
          <div className="lg:col-span-2">
            <IdeaConversionChart metric={metrics.idea_conversion} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Suppress unused-import warning when TS isn't running in JSX-aware mode.
void ChartCard;
