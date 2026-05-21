/**
 * Functional smoke test for the roadmap library (Section 5.4–5.8).
 *
 * Covers the pure helpers that drive every roadmap view: date math, the
 * Now/Next/Later auto-placement heuristic, the capacity-row builder, the
 * shared filter, and a `SettingsRepository` round-trip on the new
 * `kanban_configs` field added in Step 5.
 *
 * The view components themselves are React + DOM and aren't exercised
 * here — they would need a renderer. Their behavior is bottlenecked
 * through these helpers, so a clean run gives high confidence the views
 * compute the right things.
 *
 * Run with:
 *   npx tsx scripts/smoke-roadmap.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-roadmap-smoke-"));
process.env.IIM_DATA_DIR = scratch;

async function main() {
  const {
    parseIsoDate,
    formatIsoDate,
    todayUtc,
    addDays,
    addMonths,
    daysBetween,
    buildWindow,
    generateTicks,
    projectInterval,
  } = await import("../lib/roadmap/dates");
  const {
    NNL_COLUMNS,
    suggestedBucket,
    resolveBucket,
    isAutoPlaced,
  } = await import("../lib/roadmap/placement");
  const { buildResourceRows, findGaps, totalDays } = await import(
    "../lib/roadmap/capacity"
  );
  const {
    EMPTY_ROADMAP_FILTERS,
    isOpenStatus,
    applyRoadmapFilters,
  } = await import("../lib/roadmap/filters");
  const { ROADMAP_VIEWS, isRoadmapView } = await import("../lib/roadmap/views");
  const { SettingsRepository } = await import("../lib/db");

  // Imported just for the in-memory Project literal type.
  type Project = import("../lib/db").Project;

  // ---- Test harness. -----------------------------------------------

  let passed = 0;
  function check(label: string, cond: unknown): void {
    if (!cond) {
      console.error(`FAIL: ${label}`);
      process.exit(1);
    }
    passed += 1;
    console.log(`  ok  ${label}`);
  }

  // Build a fully-populated Project literal. Most fields are placeholder
  // values — the tests only care about a handful per case, but we keep
  // the literal type-correct so a schema change forces an explicit edit
  // here (good signal).
  function makeProject(overrides: Partial<Project> = {}): Project {
    const base: Project = {
      project_id: "2026-001",
      name: "Test project",
      description: "Lorem ipsum",
      definition_of_done: "",
      application_product: "Insights",
      project_type: "New Feature",
      date_added: "2026-01-15",
      priority: "Medium",
      status: "In Progress",
      phase: "Planning",
      primary_stakeholders: [],
      project_lead: "alex",
      additional_resources: [],
      resource_allocations: {},
      target_date: null,
      ai_complexity_score: null,
      ai_time_estimate: null,
      roadmap_bucket: null,
      roadmap_timeline_start: null,
      github_issue_id: null,
      jira_issue_id: null,
      health_score: null,
      health_score_history: [],
      status_history: [],
      depends_on: [],
      dependencies: [],
      external_dependencies: [],
      document_links: [],
      custom_fields: {},
      created_by: "alex",
      updated_at: "2026-01-15T00:00:00Z",
    };
    return { ...base, ...overrides };
  }

  // ---- views.ts ----------------------------------------------------

  console.log("views (catalog)");
  {
    // The catalog drives the on-page tab strip and the PPTX export
    // picker. Locking the count and contents prevents accidental
    // re-introduction of the deprecated Capacity tab — which now lives
    // exclusively on the Insights → Resources page — and catches any
    // future addition that ships without ROADMAP_VIEWS being updated.
    const expectedKeys: ReadonlySet<string> = new Set([
      "timeline",
      "kanban",
      "bubble",
      "now-next-later",
    ]);
    check(
      "ROADMAP_VIEWS has exactly four entries",
      ROADMAP_VIEWS.length === expectedKeys.size,
    );
    for (const v of ROADMAP_VIEWS) {
      check(
        `ROADMAP_VIEWS includes "${v.key}"`,
        expectedKeys.has(v.key),
      );
      check(
        `ROADMAP_VIEWS["${v.key}"] has a non-empty label`,
        typeof v.label === "string" && v.label.length > 0,
      );
    }
    check(
      "isRoadmapView('capacity') is false (removed)",
      !isRoadmapView("capacity"),
    );
    check(
      "isRoadmapView('timeline') is true",
      isRoadmapView("timeline"),
    );
  }

  // ---- dates.ts ----------------------------------------------------

  console.log("dates");
  {
    // parse / format round-trip
    const d = parseIsoDate("2026-04-15");
    check("parseIsoDate parses YYYY-MM-DD", d !== null);
    check(
      "parseIsoDate yields UTC midnight",
      d !== null &&
        d.getUTCFullYear() === 2026 &&
        d.getUTCMonth() === 3 &&
        d.getUTCDate() === 15 &&
        d.getUTCHours() === 0,
    );
    check(
      "formatIsoDate round-trips parseIsoDate",
      d !== null && formatIsoDate(d) === "2026-04-15",
    );
    check("parseIsoDate('') -> null", parseIsoDate("") === null);
    check("parseIsoDate(null) -> null", parseIsoDate(null) === null);
    check("parseIsoDate('garbage') -> null", parseIsoDate("garbage") === null);
  }
  {
    // arithmetic
    const a = parseIsoDate("2026-04-01")!;
    const b = parseIsoDate("2026-04-15")!;
    check("daysBetween counts whole UTC days", daysBetween(a, b) === 14);
    check("daysBetween is signed", daysBetween(b, a) === -14);
    check(
      "addDays preserves UTC midnight",
      formatIsoDate(addDays(a, 7)) === "2026-04-08",
    );
    check(
      "addMonths handles month rollover",
      formatIsoDate(addMonths(a, 2)) === "2026-06-01",
    );
  }
  {
    // buildWindow + generateTicks across granularities
    const ref = parseIsoDate("2026-04-15")!;
    const wMonths = buildWindow("months", 1, 5, ref);
    check(
      "buildWindow months: start is 1 month before reference month",
      formatIsoDate(wMonths.start) === "2026-03-01",
    );
    check(
      "buildWindow months: end is start of month after window",
      formatIsoDate(wMonths.end) === "2026-10-01",
    );
    const monthTicks = generateTicks(wMonths);
    check(
      "generateTicks months: one tick per month inside window",
      monthTicks.length === 7,
    );

    const wWeeks = buildWindow("weeks", 0, 2, ref);
    check(
      "buildWindow weeks: start is on a Monday",
      wWeeks.start.getUTCDay() === 1,
    );
    const weekTicks = generateTicks(wWeeks);
    check("generateTicks weeks: 3 weekly ticks", weekTicks.length === 3);

    const wQuarters = buildWindow("quarters", 0, 1, ref);
    const qTicks = generateTicks(wQuarters);
    check("generateTicks quarters: 2 ticks", qTicks.length === 2);
    check(
      "quarter tick label format",
      qTicks[0].label.startsWith("Q") && qTicks[0].label.includes("26"),
    );
  }
  {
    // projectInterval clipping behavior
    const ref = parseIsoDate("2026-04-15")!;
    const window = buildWindow("months", 0, 2, ref);
    // window: 2026-04-01 .. 2026-07-01

    // entirely inside
    const inside = projectInterval(
      parseIsoDate("2026-05-01"),
      parseIsoDate("2026-06-01"),
      window,
    );
    check("projectInterval inside: not hidden, not clipped", !!inside &&
      !inside.hidden && !inside.clippedStart && !inside.clippedEnd);
    check(
      "projectInterval inside: leftFrac > 0",
      !!inside && inside.leftFrac > 0 && inside.rightFrac < 1,
    );

    // start before window, end inside
    const clippedLeft = projectInterval(
      parseIsoDate("2026-02-01"),
      parseIsoDate("2026-05-01"),
      window,
    );
    check(
      "projectInterval clippedStart when start before window",
      !!clippedLeft && clippedLeft.clippedStart && !clippedLeft.clippedEnd,
    );
    check(
      "projectInterval clippedStart pins leftFrac to 0",
      !!clippedLeft && clippedLeft.leftFrac === 0,
    );

    // start inside, end after window
    const clippedRight = projectInterval(
      parseIsoDate("2026-05-01"),
      parseIsoDate("2026-09-01"),
      window,
    );
    check(
      "projectInterval clippedEnd when end after window",
      !!clippedRight && clippedRight.clippedEnd && !clippedRight.clippedStart,
    );
    check(
      "projectInterval clippedEnd pins rightFrac to 1",
      !!clippedRight && clippedRight.rightFrac === 1,
    );

    // entirely outside (after)
    const outsideAfter = projectInterval(
      parseIsoDate("2026-08-01"),
      parseIsoDate("2026-09-01"),
      window,
    );
    check(
      "projectInterval entirely after window: hidden",
      !!outsideAfter && outsideAfter.hidden,
    );

    // entirely outside (before)
    const outsideBefore = projectInterval(
      parseIsoDate("2026-01-01"),
      parseIsoDate("2026-02-01"),
      window,
    );
    check(
      "projectInterval entirely before window: hidden",
      !!outsideBefore && outsideBefore.hidden,
    );

    // missing both dates
    const missing = projectInterval(null, null, window);
    check("projectInterval(null, null) -> null", missing === null);
  }

  // ---- placement.ts ------------------------------------------------

  console.log("\nplacement");
  {
    check("NNL_COLUMNS includes Unplaced", NNL_COLUMNS.length === 4);
    check(
      "NNL_COLUMNS order: Now, Next, Later, Unplaced",
      NNL_COLUMNS[0] === "Now" &&
        NNL_COLUMNS[1] === "Next" &&
        NNL_COLUMNS[2] === "Later" &&
        NNL_COLUMNS[3] === "Unplaced",
    );

    // Status-driven branches
    const inProgress = makeProject({ status: "In Progress" });
    check(
      "suggestedBucket: In Progress -> Now",
      suggestedBucket(inProgress) === "Now",
    );
    check(
      "suggestedBucket: Blocked -> Now",
      suggestedBucket(makeProject({ status: "Blocked" })) === "Now",
    );
    check(
      "suggestedBucket: Delayed -> Now",
      suggestedBucket(makeProject({ status: "Delayed" })) === "Now",
    );

    // Date-driven branches for Not Started: imminent date pulls forward
    // to Now, but distant date does NOT push back to Later — the status
    // signal "we've committed" is stronger than "the date is far out"
    // (ROAD-16 round-3 fix: previously Not Started + far date -> Later,
    // which paradoxically made adding a target date worsen placement).
    const today = todayUtc();
    const inTwoWeeks = formatIsoDate(addDays(today, 14));
    const inTwoMonths = formatIsoDate(addDays(today, 60));
    const farFuture = formatIsoDate(addDays(today, 200));

    check(
      "suggestedBucket: Not Started + target ≤30d -> Now (date pulls forward)",
      suggestedBucket(
        makeProject({ status: "Not Started", target_date: inTwoWeeks }),
      ) === "Now",
    );
    check(
      "suggestedBucket: Not Started + target ≤90d -> Next (status floor)",
      suggestedBucket(
        makeProject({ status: "Not Started", target_date: inTwoMonths }),
      ) === "Next",
    );
    check(
      "suggestedBucket: Not Started + far target -> Next (status floor, not Later)",
      suggestedBucket(
        makeProject({ status: "Not Started", target_date: farFuture }),
      ) === "Next",
    );
    check(
      "suggestedBucket: In Planning + far target -> Next (status floor, not Later)",
      suggestedBucket(
        makeProject({ status: "In Planning", target_date: farFuture }),
      ) === "Next",
    );

    // Status alone with no target date is no longer enough to earn
    // Next — those land in Later. The Next floor only kicks in when
    // there's a target date to protect from being demoted by being
    // too far out (the original ROAD-16 round-3 concern). With no
    // date at all, "planned but not yet scheduled" is exactly Later
    // per §5.7. (ROAD-16 round-4 fix.)
    check(
      "suggestedBucket: In Planning + no target -> Later (no signal)",
      suggestedBucket(
        makeProject({ status: "In Planning", target_date: null }),
      ) === "Later",
    );
    check(
      "suggestedBucket: Not Started + no target -> Later (no signal)",
      suggestedBucket(
        makeProject({ status: "Not Started", target_date: null }),
      ) === "Later",
    );

    // On Hold goes to Unplaced regardless of date — paused is paused.
    check(
      "suggestedBucket: On Hold + no target -> Unplaced",
      suggestedBucket(
        makeProject({ status: "On Hold", target_date: null }),
      ) === "Unplaced",
    );
    check(
      "suggestedBucket: On Hold + imminent target -> Unplaced (paused beats date)",
      suggestedBucket(
        makeProject({ status: "On Hold", target_date: inTwoWeeks }),
      ) === "Unplaced",
    );

    // resolveBucket behavior
    check(
      "resolveBucket: Completed -> null (filtered out)",
      resolveBucket(makeProject({ status: "Completed" })) === null,
    );
    check(
      "resolveBucket: Canceled -> null",
      resolveBucket(makeProject({ status: "Canceled" })) === null,
    );
    check(
      "resolveBucket: stored 'Later' overrides suggestion",
      resolveBucket(
        makeProject({ status: "In Progress", roadmap_bucket: "Later" }),
      ) === "Later",
    );
    check(
      "resolveBucket: stored 'Unplaced' is honored",
      resolveBucket(
        makeProject({ status: "In Progress", roadmap_bucket: "Unplaced" }),
      ) === "Unplaced",
    );
    check(
      "resolveBucket: invalid bucket falls back to suggestion",
      resolveBucket(
        makeProject({
          status: "In Progress",
          roadmap_bucket: "Sprint 12",
        }),
      ) === "Now",
    );

    // isAutoPlaced
    check(
      "isAutoPlaced: null bucket -> true",
      isAutoPlaced(makeProject({ status: "In Progress" })) === true,
    );
    check(
      "isAutoPlaced: explicit bucket -> false",
      isAutoPlaced(
        makeProject({ status: "In Progress", roadmap_bucket: "Now" }),
      ) === false,
    );
    check(
      "isAutoPlaced: explicit Unplaced -> false (manual park)",
      isAutoPlaced(
        makeProject({ status: "On Hold", roadmap_bucket: "Unplaced" }),
      ) === false,
    );

    // Start-date-driven placement (the new primary signal).
    const startInOneWeek = formatIsoDate(addDays(today, 7));
    const startInTwoMonths = formatIsoDate(addDays(today, 60));
    const startInSixMonths = formatIsoDate(addDays(today, 180));
    const startInPast = formatIsoDate(addDays(today, -10));

    check(
      "suggestedBucket: Not Started + start ≤14d -> Now",
      suggestedBucket(
        makeProject({
          status: "Not Started",
          roadmap_timeline_start: startInOneWeek,
        }),
      ) === "Now",
    );
    check(
      "suggestedBucket: Not Started + start ≤90d -> Next",
      suggestedBucket(
        makeProject({
          status: "Not Started",
          roadmap_timeline_start: startInTwoMonths,
        }),
      ) === "Next",
    );
    check(
      "suggestedBucket: Not Started + start >90d -> Later (start dominates)",
      suggestedBucket(
        makeProject({
          status: "Not Started",
          roadmap_timeline_start: startInSixMonths,
        }),
      ) === "Later",
    );
    check(
      "suggestedBucket: start in past + Not Started -> Now (overdue start)",
      suggestedBucket(
        makeProject({
          status: "Not Started",
          roadmap_timeline_start: startInPast,
        }),
      ) === "Now",
    );
    // Both start and target — start wins per the heuristic.
    check(
      "suggestedBucket: Not Started + start near, target far -> Now",
      suggestedBucket(
        makeProject({
          status: "Not Started",
          roadmap_timeline_start: startInOneWeek,
          target_date: farFuture,
        }),
      ) === "Now",
    );
    check(
      "suggestedBucket: Not Started + start far, target near -> Later (start wins)",
      suggestedBucket(
        makeProject({
          status: "Not Started",
          roadmap_timeline_start: startInSixMonths,
          target_date: inTwoWeeks,
        }),
      ) === "Later",
    );
  }

  // ---- capacity.ts -------------------------------------------------

  console.log("\ncapacity");
  {
    const ref = parseIsoDate("2026-04-15")!;
    const window = buildWindow("months", 1, 4, ref);

    // Two projects, three resources. Alex leads both → overlap.
    const p1 = makeProject({
      project_id: "2026-001",
      name: "Alpha",
      project_lead: "Alex",
      additional_resources: ["Sam"],
      resource_allocations: {},
      status: "In Progress",
      roadmap_timeline_start: "2026-04-01",
      target_date: "2026-06-01",
    });
    const p2 = makeProject({
      project_id: "2026-002",
      name: "Beta",
      project_lead: "Alex",
      additional_resources: ["Riley"],
      resource_allocations: {},
      status: "In Progress",
      roadmap_timeline_start: "2026-04-15",
      target_date: "2026-07-01",
    });
    const closed = makeProject({
      project_id: "2026-003",
      name: "Gamma (closed)",
      project_lead: "Alex",
      status: "Completed",
      roadmap_timeline_start: "2026-04-01",
      target_date: "2026-05-01",
    });

    const rows = buildResourceRows([p1, p2, closed], window, 1);

    check(
      "buildResourceRows: 3 distinct resources",
      rows.length === 3,
    );
    check(
      "buildResourceRows: rows sorted by name",
      rows[0].resource === "Alex" &&
        rows[1].resource === "Riley" &&
        rows[2].resource === "Sam",
    );
    check(
      "buildResourceRows: Completed projects excluded",
      rows.every((r) =>
        r.assignments.every((a) => a.project.status !== "Completed"),
      ),
    );
    const alex = rows.find((r) => r.resource === "Alex")!;
    check(
      "buildResourceRows: Alex has two assignments",
      alex.assignments.length === 2,
    );
    check(
      "buildResourceRows: Alex flagged overloaded at threshold 1",
      alex.overloaded === true,
    );
    const sam = rows.find((r) => r.resource === "Sam")!;
    check(
      "buildResourceRows: Sam has 1 assignment, not overloaded",
      sam.assignments.length === 1 && sam.overloaded === false,
    );
    check(
      "buildResourceRows: Lead role recorded for Alex on Alpha",
      alex.assignments.some(
        (a) => a.project.project_id === "2026-001" && a.role === "Lead",
      ),
    );
    check(
      "buildResourceRows: Resource role recorded for Sam on Alpha",
      sam.assignments.every((a) => a.role === "Resource"),
    );

    // findGaps: Sam has one assignment in the middle → two gaps (before, after)
    const samGaps = findGaps(sam.assignments);
    check("findGaps: Sam has gaps around the assignment", samGaps.length >= 1);

    // findGaps: empty -> single full-window gap
    check(
      "findGaps: empty assignments -> 1 full-window gap",
      findGaps([]).length === 1 &&
        findGaps([])[0].leftFrac === 0 &&
        findGaps([])[0].rightFrac === 1,
    );

    // totalDays returns a positive number for an active resource
    check("totalDays: Alex has positive total", totalDays(alex.assignments) > 0);
  }

  // ---- filters.ts --------------------------------------------------

  console.log("\nfilters");
  {
    check(
      "isOpenStatus: In Progress -> true",
      isOpenStatus("In Progress") === true,
    );
    check(
      "isOpenStatus: Completed -> false",
      isOpenStatus("Completed") === false,
    );
    check(
      "isOpenStatus: Canceled -> false",
      isOpenStatus("Canceled") === false,
    );

    const dataset: Project[] = [
      makeProject({
        project_id: "2026-001",
        name: "Alpha bird",
        priority: "High",
        status: "In Progress",
        application_product: "Insights",
        project_lead: "Alex",
      }),
      makeProject({
        project_id: "2026-002",
        name: "Beta cat",
        priority: "Low",
        status: "Completed",
        application_product: "Complaints",
        project_lead: "Sam",
      }),
      makeProject({
        project_id: "2026-003",
        name: "Gamma bird",
        priority: "Critical",
        status: "Blocked",
        application_product: "Insights",
        project_lead: "Sam",
      }),
    ];

    // Default: closed hidden
    const open = applyRoadmapFilters(dataset, EMPTY_ROADMAP_FILTERS);
    check(
      "applyRoadmapFilters: hides Completed by default",
      open.length === 2 && open.every((p) => p.status !== "Completed"),
    );

    // includeClosed flag
    const all = applyRoadmapFilters(dataset, EMPTY_ROADMAP_FILTERS, {
      includeClosed: true,
    });
    check(
      "applyRoadmapFilters: includeClosed shows Completed",
      all.length === 3,
    );

    // priority filter
    const critical = applyRoadmapFilters(dataset, {
      ...EMPTY_ROADMAP_FILTERS,
      priority: ["Critical"],
    });
    check(
      "applyRoadmapFilters: priority filter narrows",
      critical.length === 1 && critical[0].project_id === "2026-003",
    );

    // lead filter
    const samLed = applyRoadmapFilters(
      dataset,
      { ...EMPTY_ROADMAP_FILTERS, project_lead: ["Sam"] },
      { includeClosed: true },
    );
    check(
      "applyRoadmapFilters: project_lead narrows",
      samLed.length === 2 && samLed.every((p) => p.project_lead === "Sam"),
    );

    // application filter
    const insights = applyRoadmapFilters(dataset, {
      ...EMPTY_ROADMAP_FILTERS,
      application_product: ["Insights"],
    });
    check(
      "applyRoadmapFilters: application_product narrows",
      insights.length === 2 &&
        insights.every((p) => p.application_product === "Insights"),
    );

    // search filter (case-insensitive, name field)
    const birds = applyRoadmapFilters(dataset, {
      ...EMPTY_ROADMAP_FILTERS,
      search: "BIRD",
    });
    check(
      "applyRoadmapFilters: search is case-insensitive on name",
      birds.length === 2 && birds.every((p) => p.name.toLowerCase().includes("bird")),
    );

    // search by project_id
    const byId = applyRoadmapFilters(dataset, {
      ...EMPTY_ROADMAP_FILTERS,
      search: "2026-003",
    });
    check(
      "applyRoadmapFilters: search by project_id",
      byId.length === 1 && byId[0].project_id === "2026-003",
    );

    // combined: priority + status filter
    const combined = applyRoadmapFilters(dataset, {
      ...EMPTY_ROADMAP_FILTERS,
      priority: ["High", "Critical"],
      status: ["In Progress"],
    });
    check(
      "applyRoadmapFilters: combined filters AND together",
      combined.length === 1 && combined[0].project_id === "2026-001",
    );
  }

  // ---- SettingsRepository.kanban_configs round-trip ----------------

  console.log("\nsettings (kanban_configs)");
  {
    // Fresh data dir → defaults applied
    const initial = await SettingsRepository.get();
    check(
      "SettingsRepository.get: kanban_configs defaults to []",
      Array.isArray(initial.kanban_configs) && initial.kanban_configs.length === 0,
    );

    // Save a config and read it back
    const cfg = {
      config_id: "cfg-1",
      name: "By Phase",
      column_field: "phase",
      swimlane_field: null,
      wip_limits: {},
      column_order: [],
      created_by: "alex",
      created_at: "2026-04-27T00:00:00Z",
    };
    await SettingsRepository.update({ kanban_configs: [cfg] });
    const after = await SettingsRepository.get();
    check(
      "SettingsRepository round-trips kanban_configs",
      after.kanban_configs.length === 1 &&
        after.kanban_configs[0].config_id === "cfg-1" &&
        after.kanban_configs[0].column_field === "phase",
    );

    // Other fields aren't clobbered by a partial update
    check(
      "SettingsRepository partial update keeps other fields",
      after.health_score_thresholds !== undefined &&
        after.branding !== undefined,
    );
  }

  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((err) => {
    console.error("UNCAUGHT:", err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
