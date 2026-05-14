/**
 * Functional smoke test for Step 6 — Project Dependencies (Section 5.10),
 * Decision & Change Log (Section 5.11), and Document & Repository Links
 * (Section 5.14).
 *
 * Three slices are exercised:
 *
 *   1. `lib/projects/links.ts`        — link validation, URL → type detection
 *   2. `lib/projects/dependencies.ts` — dep validation, cycle detection,
 *                                        upstream-status rollup
 *   3. `lib/decisions/service.ts`     — append-only entry creation
 *
 * Each uses a fresh temp data dir via IIM_DATA_DIR so the smoke test never
 * touches real data. Run with:
 *
 *   npx tsx scripts/smoke-decisions.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-step6-smoke-"));
process.env.IIM_DATA_DIR = scratch;

async function main() {
  // ---- Imports (deferred so IIM_DATA_DIR is set before any module reads it).
  const {
    detectLinkType,
    validateDocumentLinks,
    LinkValidationError,
  } = await import("../lib/projects/links");
  const {
    validateDependencies,
    reconcileDependsOn,
    findCycle,
    dependencyHealth,
    rollupDependencyHealth,
    upstreamChain,
    DependencyValidationError,
  } = await import("../lib/projects/dependencies");
  const {
    createProject,
    updateProject,
    ValidationError: ProjectValidationError,
  } = await import("../lib/projects/service");
  const {
    createDecision,
    listDecisionsForProject,
    ValidationError: DecisionValidationError,
    NotFoundError: DecisionNotFoundError,
  } = await import("../lib/decisions/service");
  const { ProjectRepository } = await import("../lib/db");

  type Project = import("../lib/db").Project;

  // ---- Tiny test harness. -------------------------------------------------

  let passed = 0;
  function check(label: string, cond: unknown): void {
    if (!cond) {
      console.error(`FAIL: ${label}`);
      process.exit(1);
    }
    passed++;
    console.log(`  ok  ${label}`);
  }

  async function expectThrows<E>(
    label: string,
    fn: () => Promise<unknown> | unknown,
    matcher: (err: unknown) => boolean,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (matcher(err)) {
        passed++;
        console.log(`  ok  ${label}`);
        return;
      }
      console.error(`FAIL: ${label} — wrong error: ${(err as Error).message}`);
      process.exit(1);
    }
    console.error(`FAIL: ${label} — expected to throw`);
    process.exit(1);
  }

  // ==========================================================================
  // 1. Document links
  // ==========================================================================

  console.log("\nDocument links — detectLinkType");
  check(
    "github.com → GitHub Repo",
    detectLinkType("https://github.com/anthropic/claude-code") === "GitHub Repo",
  );
  check(
    "github.com/.../pull/N → GitHub PR",
    detectLinkType("https://github.com/anthropic/claude-code/pull/123") ===
      "GitHub PR",
  );
  check(
    "atlassian.net /browse/ → Jira",
    detectLinkType("https://acme.atlassian.net/browse/IIM-1") === "Jira Issue",
  );
  check(
    "atlassian.net /wiki/ → Confluence",
    detectLinkType("https://acme.atlassian.net/wiki/spaces/IIM/pages/1") ===
      "Confluence",
  );
  check(
    "drive.google.com → External (was Google Drive; removed)",
    detectLinkType("https://drive.google.com/file/d/abc/view") === "External",
  );
  check(
    "figma.com → Figma",
    detectLinkType("https://www.figma.com/file/abc/Design") === "Figma",
  );
  check(
    "miro.com → Miro",
    detectLinkType("https://miro.com/app/board/abc/") === "Miro",
  );
  check(
    "notion.so → External (was Notion; removed)",
    detectLinkType("https://www.notion.so/IIM-123") === "External",
  );
  check(
    "unknown host → External",
    detectLinkType("https://random.example.com/x") === "External",
  );
  check(
    "garbage URL → External",
    detectLinkType("not a url") === "External",
  );

  console.log("\nDocument links — validateDocumentLinks");
  const ctx = { userId: "user-1", now: "2026-04-28T12:00:00Z" };

  const fresh = validateDocumentLinks(
    [
      { url: "https://github.com/foo/bar", label: "Repo" },
      { url: "https://figma.com/file/123", label: "Mockups" },
    ],
    [],
    ctx,
  );
  check("validates two-row create payload", fresh.length === 2);
  check(
    "auto-detected GitHub Repo",
    fresh[0].link_type === "GitHub Repo",
  );
  check("auto-detected Figma", fresh[1].link_type === "Figma");
  check("stamped added_by", fresh[0].added_by === "user-1");
  check("stamped added_at", fresh[0].added_at === "2026-04-28T12:00:00Z");

  const preExisting = [
    {
      label: "Old Repo",
      url: "https://github.com/foo/bar",
      link_type: "GitHub Repo" as const,
      added_by: "user-99",
      added_at: "2025-01-01T00:00:00Z",
    },
  ];
  const preserved = validateDocumentLinks(
    [{ url: "https://github.com/foo/bar", label: "Renamed Repo" }],
    preExisting,
    ctx,
  );
  check("preserves added_by on existing URL", preserved[0].added_by === "user-99");
  check(
    "preserves added_at on existing URL",
    preserved[0].added_at === "2025-01-01T00:00:00Z",
  );
  check("updates label on existing URL", preserved[0].label === "Renamed Repo");

  await expectThrows(
    "rejects empty URL",
    () => validateDocumentLinks([{ url: "", label: "x" }], [], ctx),
    (e) => e instanceof LinkValidationError,
  );
  await expectThrows(
    "rejects duplicate URL within payload",
    () =>
      validateDocumentLinks(
        [
          { url: "https://example.com", label: "a" },
          { url: "https://example.com", label: "b" },
        ],
        [],
        ctx,
      ),
    (e) =>
      e instanceof LinkValidationError &&
      /duplicates URL/.test((e as Error).message),
  );
  await expectThrows(
    "rejects unknown link_type",
    () =>
      validateDocumentLinks(
        [{ url: "https://x.com", label: "x", link_type: "Bogus" }],
        [],
        ctx,
      ),
    (e) => e instanceof LinkValidationError,
  );
  await expectThrows(
    "rejects non-array",
    () => validateDocumentLinks("hello" as unknown, [], ctx),
    (e) => e instanceof LinkValidationError,
  );

  // Default label falls back to URL when label is missing/empty.
  const labelDefault = validateDocumentLinks(
    [{ url: "https://example.com/foo" }],
    [],
    ctx,
  );
  check(
    "missing label defaults to URL",
    labelDefault[0].label === "https://example.com/foo",
  );

  // undefined / null mean "no change" — return existing as-is.
  const passthrough = validateDocumentLinks(undefined, preExisting, ctx);
  check("undefined returns existing array", passthrough === preExisting);

  // ==========================================================================
  // 2. Dependency validation + cycle detection
  // ==========================================================================

  console.log("\nDependencies — validation");

  // Build a minimal project list to validate against. We keep the literal
  // shape skeletal — only project_id is read by the validators.
  const allProjects: Pick<Project, "project_id">[] = [
    { project_id: "2026-001" },
    { project_id: "2026-002" },
    { project_id: "2026-003" },
  ];

  const okDeps = validateDependencies(
    [
      { upstream_id: "2026-001", type: "Blocks Start" },
      {
        upstream_id: "2026-002",
        type: "Blocks Phase",
        required_phase: "Application Development",
      },
    ],
    "2026-003",
    allProjects,
  );
  check("two-row dep validates", okDeps.dependencies.length === 2);
  check(
    "depends_on projects from dependencies",
    okDeps.depends_on[0] === "2026-001" && okDeps.depends_on[1] === "2026-002",
  );

  await expectThrows(
    "rejects self-loop",
    () =>
      validateDependencies(
        [{ upstream_id: "2026-003", type: "Blocks Start" }],
        "2026-003",
        allProjects,
      ),
    (e) => e instanceof DependencyValidationError,
  );
  await expectThrows(
    "rejects unknown upstream",
    () =>
      validateDependencies(
        [{ upstream_id: "2099-999", type: "Blocks Start" }],
        "2026-003",
        allProjects,
      ),
    (e) => e instanceof DependencyValidationError,
  );
  await expectThrows(
    "rejects Blocks Phase missing required_phase",
    () =>
      validateDependencies(
        [{ upstream_id: "2026-001", type: "Blocks Phase" }],
        "2026-003",
        allProjects,
      ),
    (e) => e instanceof DependencyValidationError,
  );
  await expectThrows(
    "rejects bad type enum",
    () =>
      validateDependencies(
        [{ upstream_id: "2026-001", type: "Blocks Maybe" }],
        "2026-003",
        allProjects,
      ),
    (e) => e instanceof DependencyValidationError,
  );

  // Duplicate upstream_id within payload silently dedupes.
  const deduped = validateDependencies(
    [
      { upstream_id: "2026-001", type: "Blocks Start" },
      { upstream_id: "2026-001", type: "Blocks Phase", required_phase: "Closeout" },
    ],
    "2026-003",
    allProjects,
  );
  check("dedupes duplicate upstream_id", deduped.dependencies.length === 1);
  check(
    "later entry wins on dedupe",
    deduped.dependencies[0].type === "Blocks Phase",
  );

  // reconcileDependsOn preserves existing types where IDs are unchanged.
  const existing = [
    {
      upstream_id: "2026-001",
      type: "Blocks Phase" as const,
      required_phase: "Application Development" as const,
    },
  ];
  const reconciled = reconcileDependsOn(
    ["2026-001", "2026-002"],
    existing,
    "2026-003",
    allProjects,
  );
  check(
    "reconcile preserves existing dep type",
    reconciled.dependencies.find((d) => d.upstream_id === "2026-001")?.type ===
      "Blocks Phase",
  );
  check(
    "reconcile defaults new dep to Blocks Start",
    reconciled.dependencies.find((d) => d.upstream_id === "2026-002")?.type ===
      "Blocks Start",
  );

  console.log("\nDependencies — cycle detection (findCycle)");

  // Graph: A -> B, B -> C, no cycle yet.
  const graph: Pick<Project, "project_id" | "depends_on">[] = [
    { project_id: "A", depends_on: ["B"] },
    { project_id: "B", depends_on: ["C"] },
    { project_id: "C", depends_on: [] },
  ];
  check("acyclic graph: A → B → C", findCycle("A", ["B"], graph) === null);

  // Adding C → A would close the cycle.
  const cycle = findCycle("C", ["A"], graph);
  check("detects A → B → C → A cycle", cycle !== null);
  check("cycle starts and ends at same node", cycle![0] === cycle![cycle!.length - 1]);

  // 2-cycle: A and B mutually depending — proposing B as A's upstream when
  // B already depends on A would form A → B → A.
  const twoNodeGraph: Pick<Project, "project_id" | "depends_on">[] = [
    { project_id: "A", depends_on: [] },
    { project_id: "B", depends_on: ["A"] },
  ];
  check(
    "detects 2-cycle A ↔ B",
    findCycle("A", ["B"], twoNodeGraph) !== null,
  );

  // Self-loop: A → A.
  check("detects self-loop", findCycle("A", ["A"], graph) !== null);

  // ==========================================================================
  // 3. Dependency health + upstream chain
  // ==========================================================================

  console.log("\nDependencies — health rollup");

  function fakeProject(
    id: string,
    overrides: Partial<Project> = {},
  ): Project {
    return {
      project_id: id,
      name: id,
      description: "",
      application_product: "Test",
      project_type: "New Feature",
      date_added: "2026-04-01",
      priority: "Medium",
      status: "In Progress",
      phase: "Application Development",
      primary_stakeholders: [],
      project_lead: "",
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
      document_links: [],
      custom_fields: {},
      created_by: "user-1",
      updated_at: "2026-04-01T00:00:00Z",
      ...overrides,
    };
  }

  const upstreamGreen = fakeProject("U-1", { status: "In Progress" });
  const upstreamBlocked = fakeProject("U-2", { status: "Blocked" });
  const upstreamDelayed = fakeProject("U-3", { status: "Delayed" });
  const upstreamCanceled = fakeProject("U-4", { status: "Canceled" });
  const upstreamCompleted = fakeProject("U-5", {
    status: "Completed",
    phase: "Closeout",
  });
  const upstreamEarlyPhase = fakeProject("U-6", {
    status: "In Progress",
    phase: "Qualification",
  });

  check(
    "Blocks Start + In Progress → clear",
    dependencyHealth(
      { upstream_id: "U-1", type: "Blocks Start", required_phase: null },
      upstreamGreen,
    ) === "clear",
  );
  check(
    "Blocks Start + Blocked → blocked",
    dependencyHealth(
      { upstream_id: "U-2", type: "Blocks Start", required_phase: null },
      upstreamBlocked,
    ) === "blocked",
  );
  check(
    "Blocks Start + Delayed → at-risk",
    dependencyHealth(
      { upstream_id: "U-3", type: "Blocks Start", required_phase: null },
      upstreamDelayed,
    ) === "at-risk",
  );
  check(
    "Blocks Start + Canceled → blocked",
    dependencyHealth(
      { upstream_id: "U-4", type: "Blocks Start", required_phase: null },
      upstreamCanceled,
    ) === "blocked",
  );
  check(
    "Blocks Phase, upstream past required phase → clear",
    dependencyHealth(
      {
        upstream_id: "U-1",
        type: "Blocks Phase",
        required_phase: "Qualification",
      },
      upstreamGreen,
    ) === "clear",
  );
  check(
    "Blocks Phase, upstream behind phase + In Progress → at-risk",
    dependencyHealth(
      {
        upstream_id: "U-6",
        type: "Blocks Phase",
        required_phase: "Application Development",
      },
      upstreamEarlyPhase,
    ) === "at-risk",
  );
  check(
    "Blocks Phase, upstream Completed even if behind → clear",
    dependencyHealth(
      {
        upstream_id: "U-5",
        type: "Blocks Phase",
        required_phase: "Closeout",
      },
      upstreamCompleted,
    ) === "clear",
  );
  check(
    "missing upstream → blocked (dangling)",
    dependencyHealth(
      { upstream_id: "U-X", type: "Blocks Start", required_phase: null },
      undefined,
    ) === "blocked",
  );

  // Rollup: any blocked dep wins, then any at-risk, otherwise clear.
  const dependent = fakeProject("D-1", {
    depends_on: ["U-1", "U-3", "U-2"],
    dependencies: [
      { upstream_id: "U-1", type: "Blocks Start", required_phase: null },
      { upstream_id: "U-3", type: "Blocks Start", required_phase: null },
      { upstream_id: "U-2", type: "Blocks Start", required_phase: null },
    ],
  });
  const byId = new Map<string, Project>([
    ["U-1", upstreamGreen],
    ["U-3", upstreamDelayed],
    ["U-2", upstreamBlocked],
  ]);
  check("rollup with one Blocked → blocked", rollupDependencyHealth(dependent, byId) === "blocked");

  // Without the Blocked one, fall through to at-risk.
  byId.delete("U-2");
  const dep2 = fakeProject("D-2", {
    depends_on: ["U-1", "U-3"],
    dependencies: [
      { upstream_id: "U-1", type: "Blocks Start", required_phase: null },
      { upstream_id: "U-3", type: "Blocks Start", required_phase: null },
    ],
  });
  check("rollup with delayed only → at-risk", rollupDependencyHealth(dep2, byId) === "at-risk");

  // Empty deps → null (no banner needed).
  check(
    "no deps → null rollup",
    rollupDependencyHealth(fakeProject("D-3"), byId) === null,
  );

  // upstreamChain transitively walks the graph.
  const chainBy = new Map<string, Project>([
    ["A", fakeProject("A", { depends_on: ["B", "C"] })],
    ["B", fakeProject("B", { depends_on: ["D"] })],
    ["C", fakeProject("C", { depends_on: ["D"] })],
    ["D", fakeProject("D")],
  ]);
  const chain = upstreamChain(chainBy.get("A")!, chainBy);
  check(
    "upstreamChain walks transitively (deduped)",
    chain.length === 3 && new Set(chain).size === 3,
  );

  // ==========================================================================
  // 4. Project service end-to-end with deps + links
  // ==========================================================================

  console.log("\nProject service — dependencies + links round trip");

  const baseInput = {
    description: "Test project",
    application_product: "Automated Insights",
    project_type: "New Feature" as const,
    priority: "Medium" as const,
    status: "Not Started" as const,
    phase: "Qualification" as const,
    primary_stakeholders: [],
    project_lead: "",
    additional_resources: [],
    resource_allocations: {},
    target_date: null,
  };

  const p1 = await createProject(
    { ...baseInput, name: "Upstream A" },
    { createdBy: "user-1" },
  );
  const p2 = await createProject(
    { ...baseInput, name: "Upstream B" },
    { createdBy: "user-1" },
  );
  const p3 = await createProject(
    {
      ...baseInput,
      name: "Dependent C",
      dependencies: [
        { upstream_id: p1.project_id, type: "Blocks Start" },
        {
          upstream_id: p2.project_id,
          type: "Blocks Phase",
          required_phase: "Application Development",
        },
      ],
      document_links: [
        { url: "https://github.com/foo/c", label: "Repo" },
      ],
    },
    { createdBy: "user-1" },
  );
  check("created project with 2 deps", p3.depends_on.length === 2);
  check("dependencies persisted", p3.dependencies.length === 2);
  check("Blocks Phase persisted required_phase", p3.dependencies[1].required_phase === "Application Development");
  check("document_links persisted", p3.document_links.length === 1);
  check("link auto-detected", p3.document_links[0].link_type === "GitHub Repo");
  check("link added_by stamped", p3.document_links[0].added_by === "user-1");

  // Update via depends_on shorthand.
  const updated = await updateProject(
    p3.project_id,
    { depends_on: [p1.project_id] },
    { userId: "user-1" },
  );
  check("PATCH depends_on prunes upstream", updated.depends_on.length === 1);
  check("PATCH depends_on preserves remaining type", updated.dependencies[0].type === "Blocks Start");

  // Cycle should be rejected: try making p1 depend on p3 (which depends on p1).
  await expectThrows(
    "PATCH cycle is rejected",
    () =>
      updateProject(
        p1.project_id,
        { depends_on: [p3.project_id] },
        { userId: "user-1" },
      ),
    (e) =>
      e instanceof ProjectValidationError &&
      /Circular dependency/.test((e as Error).message),
  );

  // Delete pruning: delete p1, p3.depends_on should lose p1.
  await ProjectRepository.delete(p1.project_id);
  const p3After = await ProjectRepository.getById(p3.project_id);
  check("delete prunes depends_on from dependents", p3After!.depends_on.length === 0);
  check(
    "delete prunes dependencies from dependents",
    p3After!.dependencies.length === 0,
  );

  // ==========================================================================
  // 5. Decision log service
  // ==========================================================================

  console.log("\nDecision log — service");

  // Need at least one project to attach decisions to. p2 still exists.
  await expectThrows(
    "rejects unknown project on create",
    () =>
      createDecision(
        "9999-999",
        {
          decision_summary: "Foo",
          rationale: "Bar",
          decision_type: "Other",
        },
        { userId: "user-1" },
      ),
    (e) => e instanceof DecisionNotFoundError,
  );

  await expectThrows(
    "rejects missing summary",
    () =>
      createDecision(
        p2.project_id,
        {
          rationale: "x",
          decision_type: "Other",
        } as unknown as Parameters<typeof createDecision>[1],
        { userId: "user-1" },
      ),
    (e) => e instanceof DecisionValidationError,
  );

  await expectThrows(
    "rejects bad decision_type",
    () =>
      createDecision(
        p2.project_id,
        {
          decision_summary: "Foo",
          rationale: "Bar",
          decision_type: "Refactor" as unknown as "Other",
        },
        { userId: "user-1" },
      ),
    (e) => e instanceof DecisionValidationError,
  );

  await expectThrows(
    "rejects oversized summary",
    () =>
      createDecision(
        p2.project_id,
        {
          decision_summary: "x".repeat(201),
          rationale: "Bar",
          decision_type: "Other",
        },
        { userId: "user-1" },
      ),
    (e) => e instanceof DecisionValidationError,
  );

  const d1 = await createDecision(
    p2.project_id,
    {
      decision_summary: "Descoped API integration",
      rationale: "Scope was too large for Q2 — pushing to Q3.",
      decision_type: "Scope Change",
    },
    { userId: "user-1" },
  );
  check("decision created with UUID", typeof d1.entry_id === "string" && d1.entry_id.length > 0);
  check("decision tagged with project", d1.project_id === p2.project_id);
  check("decision stamped with user", d1.made_by === "user-1");
  check("decision defaults entry_date to today", /^\d{4}-\d{2}-\d{2}$/.test(d1.entry_date));

  // Wait one ms then add a second entry; listDecisions returns newest
  // first by entry_date. Both entries are explicitly dated so the test
  // is stable as the calendar advances — without explicit dates, `d1`
  // would default to today and `d2` was originally 2026-05-01, which
  // silently inverted the expected order once "today" moved past May 1.
  const d2 = await createDecision(
    p2.project_id,
    {
      decision_summary: "Reprioritized to High",
      rationale: "Stakeholder escalation.",
      decision_type: "Priority Change",
      entry_date: "2026-06-01",
    },
    { userId: "user-1" },
  );
  check("decision accepts explicit entry_date", d2.entry_date === "2026-06-01");

  const list = await listDecisionsForProject(p2.project_id);
  check("list returns 2 entries for the project", list.length === 2);
  check("list newest-first by entry_date", list[0].entry_id === d2.entry_id);

  // Other project should not see this project's decisions.
  const otherList = await listDecisionsForProject(p3.project_id);
  check("scoped to project (no leakage)", otherList.length === 0);

  // ==========================================================================
  // Done
  // ==========================================================================

  console.log(`\n${passed} smoke checks passed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
