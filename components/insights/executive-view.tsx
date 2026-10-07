"use client";

/**
 * Executive view — read-only presenting layout.
 *
 * Quarter selector, five pillar tiles, an upcoming-releases strip, a
 * "needs attention" panel, then a section per pillar listing its
 * projects grouped by use case. No edit controls anywhere: it is meant
 * to be screen-shared in meetings by someone with Praxis access.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { HEALTH_BADGE, HEALTH_DOT } from "@/lib/projects/display";
import { ExecutiveDeckModal } from "@/components/insights/executive-deck-modal";
import {
  UNSCHEDULED,
  type ExecPillar,
  type ExecProject,
  type ExecutiveView as ExecutiveViewData,
  type ScopeOption,
  type UpcomingRelease,
  riskStatus,
} from "@/lib/executive/portfolio";

interface Props {
  view: ExecutiveViewData;
  options: ScopeOption[];
  today: string;
  upcoming: UpcomingRelease[];
  noPillarCount: number;
  /** Show the Download deck button (needs `roadmap.export`). */
  canExport?: boolean;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ExecutiveView({
  view,
  options,
  today,
  upcoming,
  noPillarCount,
  canExport = false,
}: Props) {
  const router = useRouter();
  const [deckOpen, setDeckOpen] = useState(false);

  return (
    <div className="space-y-5">
      {/* Scope selector */}
      <div
        role="tablist"
        aria-label="Quarter"
        className="flex flex-wrap items-center gap-2"
      >
        {options.map((o) => {
          const active = o.value === view.scope;
          return (
            <button
              key={o.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() =>
                router.push(
                  `/insights/executive?scope=${encodeURIComponent(o.value)}`,
                )
              }
              className={`rounded-md border px-3 py-1.5 text-sm ${
                active
                  ? "border-gray-900 bg-gray-900 font-semibold text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {o.label}
              {o.isCurrent ? " · current" : ""}{" "}
              <span className={active ? "text-gray-300" : "text-gray-400"}>
                {o.count}
              </span>
            </button>
          );
        })}
        {canExport ? (
          <button
            type="button"
            className="pol-btn pol-btn-secondary ml-auto"
            onClick={() => setDeckOpen(true)}
          >
            Download deck
          </button>
        ) : null}
        <span className={`${canExport ? "" : "ml-auto "}text-xs text-gray-500`}>
          As of {formatDate(today)}
          {view.scope !== UNSCHEDULED && view.scope === options.find((o) => o.isCurrent)?.value
            ? " · includes carried-over work from earlier quarters"
            : ""}
        </span>
      </div>

      {/* Pillar tiles */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {view.pillars.map((p) => (
          <PillarTile key={p.pillar} pillar={p} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Upcoming releases */}
        <section className="rounded-md border border-gray-200 bg-white">
          <header className="border-b border-gray-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-900">
              Upcoming releases
            </h2>
          </header>
          {upcoming.length === 0 ? (
            <p className="px-4 py-4 text-sm italic text-gray-400">
              No upcoming releases.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {upcoming.map((r) => (
                <li
                  key={r.date}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <Link
                    href={`/insights/application-release?date=${r.date}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {formatDate(r.date)}
                    {r.isNext ? " (next)" : ""}
                  </Link>
                  <span className="text-gray-600">
                    {r.projects} project{r.projects === 1 ? "" : "s"}
                    {r.atRisk > 0 ? (
                      <span className="ml-2 font-medium text-rose-600">
                        {r.atRisk} at risk
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Needs attention */}
        <section className="rounded-md border border-gray-200 bg-white">
          <header className="border-b border-gray-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-gray-900">
              Needs attention ({view.needsAttention.length})
            </h2>
          </header>
          {view.needsAttention.length === 0 ? (
            <p className="px-4 py-4 text-sm italic text-gray-400">
              Nothing flagged for this period.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {view.needsAttention.map((ep) => (
                <AttentionRow key={ep.entry.project.project_id} ep={ep} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Pillar sections */}
      {view.pillars.map((p) =>
        p.projects.length === 0 ? null : (
          <PillarSection key={p.pillar} pillar={p} />
        ),
      )}

      {view.totalShown === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No pillar-aligned Innovation projects in this period.
        </p>
      ) : null}

      {deckOpen ? (
        <ExecutiveDeckModal
          options={options}
          initialScope={view.scope}
          onClose={() => setDeckOpen(false)}
        />
      ) : null}

      <p className="text-xs text-gray-400">
        Innovation program, five core pillars only — Complaints and Other are
        not shown.
        {noPillarCount > 0
          ? ` ${noPillarCount} Innovation project${noPillarCount === 1 ? " has" : "s have"} no pillar assigned yet and ${noPillarCount === 1 ? "isn't" : "aren't"} included.`
          : ""}
      </p>
    </div>
  );
}

function PillarTile({ pillar }: { pillar: ExecPillar }) {
  const c = pillar.counts;
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {pillar.pillar}
      </div>
      <div className="mt-1 text-3xl font-semibold text-gray-900">{c.total}</div>
      <div className="text-xs text-gray-500">
        project{c.total === 1 ? "" : "s"}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
        <Phase label="Qualifying" value={c.qualifying} />
        <Phase label="In progress" value={c.inProgress} />
        <Phase label="Released" value={c.released} />
      </dl>
      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
        {c.missed > 0 ? <Badge tone="red">{c.missed} missed</Badge> : null}
        {c.atRisk > 0 ? <Badge tone="red">{c.atRisk} at risk</Badge> : null}
        {c.blocked > 0 ? <Badge tone="amber">{c.blocked} blocked</Badge> : null}
        {c.undocumented > 0 ? (
          <Badge tone="gray">{c.undocumented} need benefits/supports</Badge>
        ) : null}
        {c.missed + c.atRisk + c.blocked + c.undocumented === 0 &&
        c.total > 0 ? (
          <Badge tone="green">On track</Badge>
        ) : null}
      </div>
    </div>
  );
}

function Phase({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-base font-semibold text-gray-900">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </div>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "red" | "amber" | "gray" | "green";
  children: React.ReactNode;
}) {
  const cls = {
    red: "bg-rose-50 text-rose-800 ring-rose-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    gray: "bg-gray-50 text-gray-600 ring-gray-200",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  }[tone];
  return (
    <span className={`rounded px-1.5 py-0.5 ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function AttentionRow({ ep }: { ep: ExecProject }) {
  const p = ep.entry.project;
  const risk = riskStatus(ep);
  const reason =
    ep.entry.riskReasons[0] ?? ep.entry.blockers[0]?.reason ?? "";
  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900">
          <span className="mr-1.5 font-mono text-[11px] text-gray-500">
            {p.project_id}
          </span>
          {p.name}
        </span>
        <span className="flex shrink-0 gap-1">
          {ep.entry.missedDelivery || ep.entry.atRisk ? (
            <Badge tone="red">{risk.text}</Badge>
          ) : null}
          {ep.entry.blockers.length > 0 ? (
            <Badge tone="amber">{ep.entry.blockers.length} blocked</Badge>
          ) : null}
        </span>
      </div>
      {reason ? (
        <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{reason}</p>
      ) : null}
    </li>
  );
}

function PillarSection({ pillar }: { pillar: ExecPillar }) {
  return (
    <section className="rounded-md border border-gray-200 bg-white">
      <header className="flex items-baseline gap-3 border-b border-gray-200 px-4 py-2.5">
        <h2 className="text-base font-semibold text-gray-900">
          {pillar.pillar}
        </h2>
        <span className="text-xs text-gray-500">
          {pillar.counts.total} project{pillar.counts.total === 1 ? "" : "s"}
        </span>
      </header>
      <div className="divide-y divide-gray-100">
        {pillar.groups.map((g) => (
          <div key={g.name} className="px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {g.name}
            </h3>
            <ul className="space-y-2">
              {g.projects.map((ep) => (
                <ProjectRow key={ep.entry.project.project_id} ep={ep} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectRow({ ep }: { ep: ExecProject }) {
  const { entry } = ep;
  const p = entry.project;
  const risk = riskStatus(ep);
  return (
    <li className="grid gap-x-4 gap-y-1 rounded-md border border-gray-100 p-2.5 text-sm lg:[grid-template-columns:minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.6fr)]">
      {/* Identity + stage */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-gray-500">
            {p.project_id}
          </span>
          {p.health_score ? (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${HEALTH_BADGE[p.health_score]}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[p.health_score]}`}
              />
              {p.health_score}
            </span>
          ) : null}
          {ep.carriedOver ? <Badge tone="amber">Carried over</Badge> : null}
        </div>
        <div className="font-medium text-gray-900">{p.name}</div>
        <div className="text-[11px] text-gray-500">
          {p.stage}
          {entry.stageIndex > 0
            ? ` (${entry.stageIndex}/${entry.stageCount})`
            : ""}{" "}
          · {p.status}
        </div>
      </div>

      {/* Release + risk */}
      <div className="text-[11px]">
        <div className="text-gray-500">
          Release:{" "}
          {p.target_date ? (
            <Link
              href={`/insights/application-release?date=${p.target_date}`}
              className="text-blue-700 hover:underline"
            >
              {formatDate(p.target_date)}
            </Link>
          ) : (
            "Unscheduled"
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          <Badge tone={risk.tone}>{risk.text}</Badge>
          {entry.blockers.length > 0 ? (
            <Badge tone="amber">{entry.blockers.length} blocked</Badge>
          ) : null}
        </div>
        {entry.blockers[0] ? (
          <p className="mt-0.5 line-clamp-2 text-gray-500">
            {entry.blockers[0].reason}
          </p>
        ) : entry.riskReasons[0] ? (
          <p className="mt-0.5 line-clamp-2 text-gray-500">
            {entry.riskReasons[0]}
          </p>
        ) : null}
      </div>

      {/* Supports + benefits */}
      <div className="min-w-0 text-[11px] text-gray-600">
        <TextBlock label="Supports" text={p.supports} />
        <TextBlock label="Benefits" text={p.benefits} />
      </div>
    </li>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <p className="mb-0.5">
      <span className="font-medium uppercase tracking-wide text-gray-400">
        {label}:
      </span>{" "}
      {text.trim() ? (
        <span className="line-clamp-3 whitespace-pre-wrap">{text}</span>
      ) : (
        <span className="italic text-gray-400">Not documented</span>
      )}
    </p>
  );
}
