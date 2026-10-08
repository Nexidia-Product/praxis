/**
 * Program Coverage — read-only drill-down (pillar → use case → outcomes).
 *
 * Pure presentation of a `CoverageGraph`; navigation is plain links, so
 * this needs no client state. Status is shown three ways at once (a
 * proportional bar, a labeled chip, and counts in text) so meaning never
 * rests on color alone. The three buckets are an ordered progress scale,
 * drawn as one blue ramp against a neutral "not started" track.
 */

import Link from "next/link";

import type {
  BucketCounts,
  CoverageOutcome,
  CoverageProject,
  CoverageUseCase,
  CoverageUseCaseOutcome,
  OutcomeBucket,
  OutcomeGap,
} from "@/lib/coverage/graph";
import { coverageHref, type CoverageSelection } from "@/lib/coverage/select";
import type { CoverageGraph } from "@/lib/coverage/graph";

const BUCKET_LABEL: Record<OutcomeBucket, string> = {
  delivered: "Delivered",
  inProgress: "In progress",
  notStarted: "Not started",
};

const GAP_LABEL: Record<OutcomeGap, string> = {
  notPlanned: "No delivery project yet",
  deliveryCanceled: "Delivery project canceled",
  deliveryMissing: "Delivery project not found",
};

// Ordinal blue ramp + neutral track, validated with the dataviz skill's
// --ordinal check in both modes (see PR description).
const CSS = `
.pc-root {
  --pc-delivered: #1c5cab;
  --pc-progress: #86b6ef;
  --pc-notstarted: #e1e0d9;
  --pc-notstarted-ring: #c3c2b7;
  --pc-surface: #fcfcfb;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .pc-root {
    --pc-delivered: #6da7ec;
    --pc-progress: #184f95;
    --pc-notstarted: #383835;
    --pc-notstarted-ring: #52514e;
    --pc-surface: #1a1a19;
  }
}
:root[data-theme="dark"] .pc-root {
  --pc-delivered: #6da7ec;
  --pc-progress: #184f95;
  --pc-notstarted: #383835;
  --pc-notstarted-ring: #52514e;
  --pc-surface: #1a1a19;
}
.pc-seg-delivered { background: var(--pc-delivered); }
.pc-seg-inProgress { background: var(--pc-progress); }
.pc-seg-notStarted { background: var(--pc-notstarted); box-shadow: inset 0 0 0 1px var(--pc-notstarted-ring); }
`;

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function ProgramCoverageView({
  graph,
  selection,
}: {
  graph: CoverageGraph;
  selection: CoverageSelection;
}) {
  return (
    <div className="pc-root space-y-5">
      <style>{CSS}</style>

      {selection.level === 1 ? <PillarsLevel graph={graph} /> : null}
      {selection.level === 2 ? (
        <UseCasesLevel pillar={selection.pillar} />
      ) : null}
      {selection.level === 3 ? (
        <UseCaseLevel pillar={selection.pillar.pillar} useCase={selection.useCase} />
      ) : null}

      <Legend />
      <p className="text-xs text-gray-400">
        Innovation program, five core pillars; projects on Tracks D–H
        (UI/Application, TopicAI, Complaints, Other, Services Validation) are
        not included. A use case outcome is delivered when every project that
        supports it is delivered; a project is delivered when it has reached
        Productization and so have the delivery projects of its own outcomes.
        {graph.excluded.projectsWithoutUseCase > 0
          ? ` ${plural(graph.excluded.projectsWithoutUseCase, "pillar project")} ${graph.excluded.projectsWithoutUseCase === 1 ? "isn't" : "aren't"} in a use case yet.`
          : ""}
        {graph.excluded.useCasesWithoutPillar > 0
          ? ` ${plural(graph.excluded.useCasesWithoutPillar, "use case")} without a core pillar ${graph.excluded.useCasesWithoutPillar === 1 ? "isn't" : "aren't"} shown.`
          : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 1 — pillars
// ---------------------------------------------------------------------------

function PillarsLevel({ graph }: { graph: CoverageGraph }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
      {graph.pillars.map((p) => (
        <Link
          key={p.pillar}
          href={coverageHref(p.pillar)}
          className="block rounded-md border border-gray-200 bg-white p-3 shadow-sm hover:border-gray-400"
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {p.pillar}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {plural(p.useCases.length, "use case")} ·{" "}
            {plural(p.counts.total, "outcome")}
          </div>
          <div className="mt-2">
            <StatusBar counts={p.counts} />
          </div>
          <CountsLine counts={p.counts} />
          {p.gapCount > 0 ? (
            <div className="mt-2">
              <Flag>{plural(p.gapCount, "outcome")} with no supporting project</Flag>
            </div>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 2 — a pillar's use cases
// ---------------------------------------------------------------------------

function UseCasesLevel({ pillar }: { pillar: CoverageGraph["pillars"][number] }) {
  return (
    <section className="space-y-3">
      <BackLink href={coverageHref()} label="All pillars" />
      <header className="rounded-md border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">{pillar.pillar}</h2>
        <div className="mt-2 max-w-xl">
          <StatusBar counts={pillar.counts} />
          <CountsLine counts={pillar.counts} />
        </div>
      </header>

      {pillar.useCases.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No use cases are assigned to this pillar yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Use case</th>
                <th className="px-4 py-2 font-semibold">Projects</th>
                <th className="px-4 py-2 font-semibold">Outcomes</th>
                <th className="px-4 py-2 font-semibold">Needs attention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pillar.useCases.map((u) => (
                <tr key={u.use_case_id} className="align-top">
                  <td className="px-4 py-3">
                    <Link
                      href={coverageHref(pillar.pillar, u.use_case_id)}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.projects.map((p) => (
                        <Dot
                          key={p.ref.project_id}
                          bucket={p.bucket}
                          label={`${p.ref.name} — ${BUCKET_LABEL[p.bucket]} (${p.ref.stage})`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {plural(u.projects.length, "project")}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.outcomes.map((o) => (
                        <Dot
                          key={o.id}
                          bucket={o.bucket}
                          label={`${o.text} — ${BUCKET_LABEL[o.bucket]}`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {u.counts.total === 0
                        ? "No outcomes defined"
                        : `${u.counts.delivered} of ${u.counts.total} delivered`}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <AttentionFlags useCase={u} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The "needs attention" flags for a use case (shared by the table and the detail page). */
function AttentionFlags({ useCase: u }: { useCase: CoverageUseCase }) {
  const flags: string[] = [];
  if (u.projects.length > 0 && u.outcomes.length === 0) {
    flags.push("No outcomes defined");
  }
  if (u.gapCount > 0) {
    flags.push(`${plural(u.gapCount, "outcome")} with no supporting project`);
  }
  if (u.outcomes.length > 0 && u.unlinkedProjects.length > 0) {
    flags.push(`${plural(u.unlinkedProjects.length, "project")} not linked to an outcome`);
  }
  if (u.projectOutcomeGapCount > 0) {
    flags.push(`${plural(u.projectOutcomeGapCount, "project outcome")} without a delivery project`);
  }
  if (flags.length === 0) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Flag key={f}>{f}</Flag>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level 3 — a use case: its outcomes, with the projects that support each
// ---------------------------------------------------------------------------

function UseCaseLevel({ pillar, useCase }: { pillar: string; useCase: CoverageUseCase }) {
  const hasOutcomes = useCase.outcomes.length > 0;
  return (
    <section className="space-y-3">
      <BackLink href={coverageHref(pillar)} label={pillar} />
      <header className="rounded-md border border-gray-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {pillar}
        </div>
        <h2 className="text-base font-semibold text-gray-900">{useCase.name}</h2>
        {useCase.description.trim() ? (
          <p className="mt-1 max-w-3xl whitespace-pre-wrap text-sm text-gray-600">
            {useCase.description}
          </p>
        ) : null}
        <div className="mt-2 max-w-xl">
          <StatusBar counts={useCase.counts} />
          <CountsLine counts={useCase.counts} />
        </div>
        <div className="mt-2">
          <AttentionFlags useCase={useCase} />
        </div>
        {useCase.warnings.map((w) => (
          <p key={w} className="mt-2 text-xs text-amber-800">
            {w}
          </p>
        ))}
      </header>

      {!hasOutcomes ? (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
          No outcomes are defined for this use case yet. Add them under Admin →
          Use cases, then choose which ones each project supports on the project
          form.
        </p>
      ) : (
        <ul className="space-y-3">
          {useCase.outcomes.map((o) => (
            <UseCaseOutcomeCard key={o.id} outcome={o} />
          ))}
        </ul>
      )}

      {useCase.projects.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No projects in this use case yet.
        </p>
      ) : hasOutcomes ? (
        useCase.unlinkedProjects.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Projects not linked to an outcome ({useCase.unlinkedProjects.length})
            </h3>
            <ul className="space-y-2">
              {useCase.unlinkedProjects.map((p) => (
                <ProjectCard key={p.ref.project_id} project={p} />
              ))}
            </ul>
          </section>
        ) : null
      ) : (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Projects ({useCase.projects.length})
          </h3>
          <ul className="space-y-2">
            {useCase.projects.map((p) => (
              <ProjectCard key={p.ref.project_id} project={p} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function UseCaseOutcomeCard({ outcome }: { outcome: CoverageUseCaseOutcome }) {
  return (
    <li className="rounded-md border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-3">
        <span className="min-w-0 flex-1 text-sm font-semibold text-gray-900">
          {outcome.text}
        </span>
        {outcome.gap === "noSupport" ? <Flag>No project supports this yet</Flag> : null}
        <Chip bucket={outcome.bucket} />
      </div>
      {outcome.projects.length === 0 ? (
        <p className="px-4 py-3 text-sm italic text-gray-400">
          Choose this outcome on a project in the use case to align it here.
        </p>
      ) : (
        <ul className="space-y-2 bg-gray-50/60 p-3">
          {outcome.projects.map((p) => (
            <ProjectCard key={p.ref.project_id} project={p} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ProjectCard({ project }: { project: CoverageProject }) {
  const r = project.ref;
  return (
    <li className="rounded-md border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="font-mono text-[11px] text-gray-500">{r.project_id}</span>
        <Link
          href={`/projects?id=${encodeURIComponent(r.project_id)}`}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          {r.name}
        </Link>
        <Chip bucket={project.bucket} />
        <span className="text-xs text-gray-500">
          {r.stage}
          {project.visualization_type ? ` · ${project.visualization_type}` : ""}
          {r.target_date ? ` · Release ${formatDate(r.target_date)}` : " · Unscheduled"}
          {project.supportedOutcomeIds.length > 1
            ? ` · supports ${project.supportedOutcomeIds.length} outcomes`
            : ""}
        </span>
      </div>

      {project.noOutcomes ? (
        <p className="border-t border-gray-100 px-4 py-2 text-xs italic text-gray-400">
          No outcomes of its own defined yet.
        </p>
      ) : (
        // Collapsed by default: a project that supports several use case
        // outcomes appears under each, and its own outcomes (with their
        // delivery projects) are detail, not the headline.
        <details className="border-t border-gray-100">
          <summary className="cursor-pointer px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">
            Its own outcomes: {project.counts.delivered} delivered ·{" "}
            {project.counts.inProgress} in progress · {project.counts.notStarted} not
            started
            {project.outcomes.some((o) => o.gap !== null) ? (
              <span className="ml-2">
                <Flag>needs a delivery project</Flag>
              </span>
            ) : null}
          </summary>
          <ul className="divide-y divide-gray-100 border-t border-gray-100">
            {project.outcomes.map((o) => (
              <OutcomeRow key={o.id} outcome={o} />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function OutcomeRow({ outcome: o }: { outcome: CoverageOutcome }) {
  const tags = [o.product, o.type].filter(Boolean).join(" · ");
  const d = o.delivery;
  return (
    <li className="grid gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:[grid-template-columns:minmax(0,1.4fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0 text-gray-900">
        {o.text}
        {tags ? <span className="text-gray-400"> ({tags})</span> : null}
      </div>
      <div className="min-w-0 text-xs text-gray-600">
        {d.kind === "project" && d.project ? (
          <>
            Delivered by{" "}
            <Link
              href={`/projects?id=${encodeURIComponent(d.project.project_id)}`}
              className="text-blue-700 hover:underline"
            >
              {d.project.name}
            </Link>{" "}
            <span className="font-mono text-[11px] text-gray-500">
              {d.project.project_id}
            </span>
            <div className="text-gray-500">
              {d.project.stage}
              {d.sharedCount > 1 ? ` · shared by ${d.sharedCount} outcomes` : ""}
            </div>
          </>
        ) : d.kind === "self" ? (
          <span>Delivered by this project</span>
        ) : null}
        {o.gap ? <Flag>{GAP_LABEL[o.gap]}</Flag> : null}
      </div>
      <div className="sm:justify-self-end">
        <Chip bucket={o.bucket} />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-block text-sm text-blue-700 hover:underline">
      ← {label}
    </Link>
  );
}

/** Proportional bar: delivered | in progress | not started, with 2px gaps. */
function StatusBar({ counts }: { counts: BucketCounts }) {
  const label = `${counts.delivered} delivered, ${counts.inProgress} in progress, ${counts.notStarted} not started`;
  if (counts.total === 0) {
    return (
      <div
        role="img"
        aria-label="No outcomes"
        className="h-2 rounded bg-gray-100"
      />
    );
  }
  const order: OutcomeBucket[] = ["delivered", "inProgress", "notStarted"];
  return (
    <div role="img" aria-label={label} className="flex h-2 gap-0.5 overflow-hidden rounded">
      {order.map((b) =>
        counts[b] === 0 ? null : (
          <div
            key={b}
            title={`${BUCKET_LABEL[b]}: ${counts[b]}`}
            className={`pc-seg-${b} first:rounded-l last:rounded-r`}
            style={{ flexGrow: counts[b], flexBasis: 0 }}
          />
        ),
      )}
    </div>
  );
}

function CountsLine({ counts }: { counts: BucketCounts }) {
  if (counts.total === 0) {
    return <div className="mt-1 text-xs text-gray-400">No outcomes yet</div>;
  }
  return (
    <div className="mt-1 text-xs text-gray-600">
      {counts.delivered} delivered · {counts.inProgress} in progress ·{" "}
      {counts.notStarted} not started
    </div>
  );
}

function Swatch({ bucket }: { bucket: OutcomeBucket }) {
  return (
    <span
      aria-hidden="true"
      className={`pc-seg-${bucket} inline-block h-2.5 w-2.5 shrink-0 rounded-sm`}
    />
  );
}

function Dot({ bucket, label }: { bucket: OutcomeBucket; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`pc-seg-${bucket} inline-block h-3 w-3 rounded-full`}
    />
  );
}

function Chip({ bucket }: { bucket: OutcomeBucket }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700">
      <Swatch bucket={bucket} />
      {BUCKET_LABEL[bucket]}
    </span>
  );
}

function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-200">
      {children}
    </span>
  );
}

function Legend() {
  const buckets: OutcomeBucket[] = ["delivered", "inProgress", "notStarted"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
      {buckets.map((b) => (
        <span key={b} className="inline-flex items-center gap-1.5">
          <Swatch bucket={b} />
          {BUCKET_LABEL[b]}
        </span>
      ))}
    </div>
  );
}
