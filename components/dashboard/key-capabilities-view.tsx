"use client";

/**
 * Key Capabilities dashboard view.
 *
 * Mirrors the Resources "Performance" tab's shape — a per-item detail
 * card with an identity/health header and a compact stats strip — but
 * the item is a PROJECT, and the cards are grouped into the quarter each
 * key capability is committed to (max two per quarter). Admins
 * (`canManage`) get controls to designate projects, slot them into a
 * quarter, and remove the designation; everyone else sees a read-only
 * board.
 *
 * Mutations go through PUT /api/projects/[id]/key-capability and then
 * `router.refresh()` re-pulls the server data — simpler and less
 * error-prone than reconciling the quarter grouping in local state.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  HEALTH_BADGE,
  HEALTH_DOT,
  HEALTH_TOOLTIP,
  priorityBadgeClass,
} from "@/lib/projects/display";
import {
  formatQuarter,
  latestStatusSummary,
  type ProjectTaskStats,
} from "@/lib/key-capabilities";
import type { Project } from "@/lib/db";

/** Display-only mirror of the service-enforced cap. */
const MAX_PER_QUARTER = 2;

export interface KeyCapabilityCard {
  project: Project;
  stats: ProjectTaskStats;
}

interface PickItem {
  project_id: string;
  name: string;
  application_product: string;
}

interface Props {
  cards: KeyCapabilityCard[];
  quarters: string[];
  currentQuarter: string;
  unflaggedProjects: PickItem[];
  canManage: boolean;
}

export function KeyCapabilitiesView({
  cards,
  quarters,
  currentQuarter,
  unflaggedProjects,
  canManage,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addSelection, setAddSelection] = useState<string>("");

  async function mutate(projectId: string, body: Record<string, unknown>) {
    if (pending) return;
    setError(null);
    setPending(projectId);
    const res = await fetch(`/api/projects/${projectId}/key-capability`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(null);
    if (!res.ok) {
      setError(data.error ?? "Update failed.");
      return;
    }
    router.refresh();
  }

  // Group cards by their committed quarter; null quarter → "not yet slotted".
  const byQuarter = new Map<string, KeyCapabilityCard[]>();
  const unassigned: KeyCapabilityCard[] = [];
  for (const card of cards) {
    const q = card.project.key_capability_quarter;
    if (q) {
      const arr = byQuarter.get(q);
      if (arr) arr.push(card);
      else byQuarter.set(q, [card]);
    } else {
      unassigned.push(card);
    }
  }

  const totalCount = cards.length;
  const currentQuarterCount = (byQuarter.get(currentQuarter) ?? []).length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm">
        <span>
          <span className="font-semibold text-gray-900">{totalCount}</span>{" "}
          <span className="text-gray-500">key capabilities</span>
        </span>
        <span>
          <span className="font-semibold text-gray-900">
            {currentQuarterCount}/{MAX_PER_QUARTER}
          </span>{" "}
          <span className="text-gray-500">
            slotted for {formatQuarter(currentQuarter)} (current)
          </span>
        </span>
        <span>
          <span className="font-semibold text-gray-900">
            {unassigned.length}
          </span>{" "}
          <span className="text-gray-500">not yet slotted</span>
        </span>
      </div>

      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      {/* Designate a new key capability */}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
          <label
            htmlFor="add-key-capability"
            className="text-sm font-medium text-gray-700"
          >
            Add a key capability:
          </label>
          <select
            id="add-key-capability"
            value={addSelection}
            onChange={(e) => setAddSelection(e.target.value)}
            disabled={pending !== null || unflaggedProjects.length === 0}
            className="min-w-[16rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">
              {unflaggedProjects.length === 0
                ? "All projects are already key capabilities"
                : "Select a project…"}
            </option>
            {unflaggedProjects.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.project_id} — {p.name}
                {p.application_product ? ` (${p.application_product})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="pol-btn pol-btn-primary"
            disabled={!addSelection || pending !== null}
            onClick={() => {
              const id = addSelection;
              setAddSelection("");
              void mutate(id, { is_key_capability: true });
            }}
          >
            {pending === addSelection && addSelection ? "Adding…" : "Add"}
          </button>
        </div>
      ) : null}

      {/* Quarter sections */}
      {quarters.map((q) => {
        const items = byQuarter.get(q) ?? [];
        const isCurrent = q === currentQuarter;
        const full = items.length >= MAX_PER_QUARTER;
        return (
          <section
            key={q}
            className="rounded-md border border-gray-200 bg-white"
          >
            <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-gray-900">
                {formatQuarter(q)}
              </h2>
              {isCurrent ? (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                  Current
                </span>
              ) : null}
              <span
                className={`text-xs ${full ? "text-gray-500" : "text-emerald-700"}`}
              >
                {items.length}/{MAX_PER_QUARTER}
                {full ? " — full" : " — open slot"}
              </span>
            </header>
            <div className="p-3">
              {items.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs italic text-gray-400">
                  No key capability slotted for this quarter
                  {canManage && unassigned.length > 0
                    ? " — assign one from “Not yet slotted” below."
                    : "."}
                </p>
              ) : (
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
                  {items.map((card) => (
                    <ProjectCapabilityCard
                      key={card.project.project_id}
                      card={card}
                      quarters={quarters}
                      canManage={canManage}
                      pending={pending === card.project.project_id}
                      onChangeQuarter={(value) =>
                        mutate(card.project.project_id, {
                          key_capability_quarter: value || null,
                        })
                      }
                      onRemove={() =>
                        mutate(card.project.project_id, {
                          is_key_capability: false,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        );
      })}

      {/* Not-yet-slotted pool */}
      {unassigned.length > 0 ? (
        <section className="rounded-md border border-gray-200 bg-white">
          <header className="border-b border-gray-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-900">
              Not yet slotted
            </h2>
            <p className="text-xs text-gray-500">
              Key capabilities without a committed quarter.
              {canManage ? " Assign each to a quarter below." : ""}
            </p>
          </header>
          <div className="p-3">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
              {unassigned.map((card) => (
                <ProjectCapabilityCard
                  key={card.project.project_id}
                  card={card}
                  quarters={quarters}
                  canManage={canManage}
                  pending={pending === card.project.project_id}
                  onChangeQuarter={(value) =>
                    mutate(card.project.project_id, {
                      key_capability_quarter: value || null,
                    })
                  }
                  onRemove={() =>
                    mutate(card.project.project_id, {
                      is_key_capability: false,
                    })
                  }
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {totalCount === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No key capabilities yet.
          {canManage
            ? " Use “Add a key capability” above to designate a project."
            : ""}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One project card — identity + health header, then the task-progress strip.
// ---------------------------------------------------------------------------

function ProjectCapabilityCard({
  card,
  quarters,
  canManage,
  pending,
  onChangeQuarter,
  onRemove,
}: {
  card: KeyCapabilityCard;
  quarters: string[];
  canManage: boolean;
  pending: boolean;
  onChangeQuarter: (quarter: string) => void;
  onRemove: () => void;
}) {
  const { project, stats } = card;
  const statusSummary = latestStatusSummary(project.status_history);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-3 shadow-sm">
      {/* Identity + health */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-gray-500">
              {project.project_id}
            </span>
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${priorityBadgeClass(project.priority)}`}
            >
              {project.priority}
            </span>
          </div>
          <h3 className="mt-0.5 truncate text-sm font-semibold text-gray-900">
            {project.name}
          </h3>
        </div>
        {project.health_score ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${HEALTH_BADGE[project.health_score]}`}
            title={HEALTH_TOOLTIP[project.health_score]}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[project.health_score]}`}
            />
            {project.health_score}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-gray-400">No health</span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
        <span>{project.status}</span>
        <span>Lead: {project.project_lead || "—"}</span>
        <span>Target: {project.target_date || "—"}</span>
      </div>

      {/* Task progress */}
      <div className="grid grid-cols-4 gap-2 border-t border-gray-100 pt-2">
        <MiniStat label="Open" value={stats.open} />
        <MiniStat label="Past due" value={stats.pastDue} danger={stats.pastDue > 0} />
        <MiniStat label="Blocked" value={stats.blocked} danger={stats.blocked > 0} />
        <MiniStat label="Done" value={stats.completed} />
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] text-gray-500">
          <span>
            {stats.completed}/{stats.total} tasks complete
          </span>
          <span className="font-medium text-gray-700">
            {stats.pctComplete}%
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${stats.pctComplete}%` }}
          />
        </div>
      </div>

      {/* Latest status summary note (blank when none recorded) */}
      <div className="text-[11px] leading-snug">
        <span className="font-medium uppercase tracking-wide text-gray-400">
          Status
        </span>
        {statusSummary ? (
          <p className="mt-0.5 text-gray-600">{statusSummary}</p>
        ) : (
          <p className="mt-0.5 italic text-gray-400">—</p>
        )}
      </div>

      {/* Management controls */}
      {canManage ? (
        <div className="flex items-center gap-2 border-t border-gray-100 pt-2">
          <label className="sr-only" htmlFor={`q-${project.project_id}`}>
            Quarter for {project.name}
          </label>
          <select
            id={`q-${project.project_id}`}
            value={project.key_capability_quarter ?? ""}
            disabled={pending}
            onChange={(e) => onChangeQuarter(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">Not yet slotted</option>
            {quarters.map((q) => (
              <option key={q} value={q}>
                {formatQuarter(q)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className="pol-btn pol-btn-ghost pol-btn-sm whitespace-nowrap text-rose-700"
            title="Remove key-capability designation"
          >
            {pending ? "…" : "Remove"}
          </button>
        </div>
      ) : (
        <div className="border-t border-gray-100 pt-2 text-[11px] text-gray-500">
          {project.key_capability_quarter
            ? `Committed to ${formatQuarter(project.key_capability_quarter)}`
            : "Not yet slotted into a quarter"}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={`text-base font-semibold ${danger ? "text-rose-600" : "text-gray-900"}`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </div>
    </div>
  );
}
