# Praxis — Executive Alignment Roadmap (Phases 1–3)

_Written 2026-10-07. Reference document for resuming this work. Read this first
when picking the executive-alignment effort back up._

## 1. Purpose and how to use this document

The team leader asked for Praxis to evolve so that every project is tied to a
business objective ("pillar"), carries a documented case for what it supports
and benefits, is verified and adopted by Services, spawns follow-up improvement
work, and rolls up into views executives can use. Work was proposed in three
phases. This document records, for each phase, **what was recommended**, **what
was implemented**, and **what is still outstanding**, plus the decisions made
along the way and a readiness checklist for the data.

**Current status:** Phases 1 and 2 are built and merged to `main` (with two
deliberate scope changes noted below). Phase 3 is not started. The owner is
pausing development to build out the other tracks/stages and bring all existing
projects up to date with the new capabilities (see section 6) before continuing.

**Also built since (2026-10-08):** the Program Coverage page, outcome delivery
links and post-Productization stage support (section 8.4). That concept is
**under review with stakeholders**; its deck slide is on hold until then.

## 2. The original notes (leader's direction, condensed)

- Every work item must ultimately align with an objective. For innovation work
  there are 5 pillars/objectives: **Cost-to-Serve, Revenue, Compliance, Customer
  Experience, Agent Experience**. A few additional ones (Complaints, Other)
  cover work that supports the pillars only indirectly.
- Everything needs a home in how it influences the business, in a way the
  C-suite will buy into.
- Each project should record **what it supports and what it benefits** — ideally
  before analysis or any work.
- Flow: qualify → analysis → visualization → execution guidance for the
  customer (post-analysis/delivery).
- Key artifacts (analysis & presentation; outputs such as generated bots) must
  be **verified**.
- Work on an outcome isn't done until **Services is using it and we have
  confirmation**.
- A cadence of follow-up and feedback for generated components (e.g. Cognigy
  bots): **separate, ideally auto-generated projects on a predictable schedule**
  (e.g. 90 days post deployment).
- Likely needs **executive-level views**: which projects are in which
  outcome/pillar, with status, risks, etc.

## 3. Decisions the owner made (these constrain future work)

| Topic | Decision |
|---|---|
| "Outcome" in exec views | Means the **objective/pillar** (the 5 core ones). |
| Benefits | **Qualitative free text**, not KPIs. ROI is calculated per customer inside each analysis output, so it is not built into Praxis. |
| Where benefits live | **Project level**, rolling up to the **use case** level. |
| Supports | A **separate free-text block** (not derived from the use case/pillar). |
| Benefits format | **One free-text block**; several points may share it. |
| Enforcement | **Never a hard block.** Missing Supports/Benefits are a soft flag only; projects still move into analysis. |
| Executive audience | VPs on the NiCE side, **no Praxis access**. A Praxis user screen-shares the page in meetings; a **PowerPoint deck** is also wanted. |
| Meeting cadence | **Monthly and quarterly** (QBRs). Views are quarter-aware. |
| Quarters | By **Target Application Deployment Date**. NiCE fiscal = calendar year. Projects with no date go to **Unscheduled**. |
| Scope | **Innovation program only.** Executive view shows the **5 core pillars only** — Complaints and Other excluded. |
| Deck | **PowerPoint only**; use **existing branding** for now. |
| Release calendar | Every other Friday, anchored on **2026-10-09**. Only scheduled dates are listed; nothing before 10/9/26; off-cycle dates are excluded. |
| Primary objective ↔ "primary capability" | Use **Primary Objective**. |
| Risk rules | Based on **stage, not project status** (see section 7). A project is not "done" at release — post-release tasks continue. |
| Adoption confirmation | Services staff have **no Praxis accounts**. A member of the innovation team records it on their behalf. It is a process (testing, feedback), not a yes/no. |
| Verification stages | **Owner will build these as stages on the relevant tracks** and add any auto-advance logic themselves. **Skipped in the Phase 2 build.** |
| Follow-ups | Flexible; first case is **Cognigy bots**; clock **defaults to the release date**. |
| Pillar/use-case assignment | Owner is assigning these manually while structuring use cases. A worklist/bulk-assign tool was **declined**. |
| Per-outcome vs per-project verification | **Per project** ("each bot is built in a specific project anyway"). |
| Stage order around Productization | Validation and adoption stages come **after** Productization (that is often the only way the functionality becomes available). **Productization = delivered** for reporting. _(2026-10-08)_ |
| Program Coverage view (planned) | Objective → use case → visualization projects → outcomes, **as of now** (no quarter filter), at a much lower level of detail than other views. Outcome status buckets: **Not started / In progress / Delivered** (Delivered = delivery project has reached Productization). _(2026-10-08)_ |
| Outcome → delivery project link (planned) | Each outcome points at the project that delivers it: **another project**, **this project**, or **not yet planned** (null). Every project has outcomes; the link is how a visualization project's outcome is tied to e.g. a Cognigy build. Delivery projects stay out of use-case membership and render as leaves. _(2026-10-08)_ |

## 4. Phase summary

| | Recommended | Implemented | Outstanding |
|---|---|---|---|
| **Phase 1** | Supports + Benefits fields (soft flags); executive view by pillar; "unaligned work" report | Supports + Benefits; Executive view (quarter-aware); unaligned *footnote count* | Data entry on projects; validate the view against real data. Worklist report intentionally dropped. |
| **Phase 2** | PowerPoint deck export (monthly + QBR presets); verification stages per project | Deck export (both presets, configurable) | Verification stages (owner is building as track stages); tune deck with real data |
| **Phase 3** | Follow-up rules (auto-generated projects); artifacts register | **Nothing** | **Everything** — see section 8 |

## 5. Detail by phase

### Phase 1 — Business case + executive view

**Recommended:** Supports/Benefits fields with soft flags and a gate that warns
rather than blocks; a use-case benefits rollup; a read-only executive view of
the Innovation portfolio by pillar, quarter-aware; a report of projects missing
a pillar.

**Implemented** (PR #30, migration `0039`):
- **Supports** and **Benefits** free-text fields on projects: project form,
  quick view ("Not documented yet" when empty), PROJECT.md export sections, and
  each project's benefits shown under it in the use case admin list (rollup).
- **Executive view** at `/insights/executive` (first item under Insights):
  - Quarter tabs: previous, current, next 3, plus Unscheduled. Counts per tab.
  - Current quarter also shows earlier-quarter work not yet at Productization,
    labelled **carried over**.
  - Five pillar tiles (phase counts; missed / at risk / blocked / need
    benefits badges), upcoming-releases strip, "Needs attention" list, and a
    section per pillar grouped by use case. Rows show stage, status, health,
    release, risk/blockers, Supports and Benefits.
  - Footnote counts Innovation projects that have **no pillar** yet.
  - Read-only; designed to be screen-shared.
- Bug fix shipped with it: **Definition of done was not saved on project
  create** (the insert omitted it). Fixed; projects created earlier still have
  it blank.

**Outstanding:**
- Fill in Supports/Benefits on projects (data, not code).
- Review the view with real data and adjust layout/wording.
- _Dropped by decision:_ "projects needing a pillar/use case" worklist and bulk
  assign.

### Phase 2 — Deck export (+ verification, skipped)

**Recommended:** PowerPoint export with two presets and adjustable parameters;
verification stages per project with history (Automated Validation, AV
Remediation, Human Validation, HV Remediation, Live Customer Test Build,
Feedback, Adoption), updated by the innovation team on Services' behalf.

**Implemented** (PR #31 + build fix; no migration):
- **Download deck** button on the Executive view (needs `roadmap.export`).
- **Presets** (all options adjustable): **Monthly update** (summary, risks &
  blockers, upcoming releases, pillar slides at summary detail) and **Quarterly
  business review** (summary, delivered, detailed pillar slides with
  Supports/Benefits, risks, next quarter's plan, releases).
- Options: quarter, pillars, which slides, summary vs detailed, optional title.
- Existing template branding + title slide reused. Pillar slides paginate
  (4 detailed / 9 summary rows per slide); long text is clipped.
- Server route `POST /api/export/executive-deck`; plan logic in
  `lib/executive/deck.ts`; renderer in `lib/export/executive-slides.ts`.
- Verified by rendering a sample deck in PowerPoint (sample data only).

**Outstanding:**
- **Verification stages — deliberately not built.** Owner will add them as
  stages on the appropriate tracks (see the critical dependency below).
- Fine-tune the deck against real data (slide counts, text fit, wording).
- Possibly show per-project verification/adoption status in the Executive view
  and deck once those stages exist.

### Phase 3 — Follow-ups and artifacts (NOT STARTED)

See section 8 for the full proposal.

## 6. Readiness checklist — before resuming development

The owner's stated plan: build out the other tracks/stages and bring all
projects up to date with current capabilities. Use this list.

### 6.1 Run these migrations (in order) if not already run
`0034_use_cases`, `0035_use_case_primary_secondary_objectives`,
`0036_use_case_caveats` (superseded, harmless), `0037_release_caveats` (also
drops `use_cases.caveats`), `0038_use_case_objective_inheritance`,
`0039_project_supports_benefits`, `0040_use_case_outcomes`. Also `0033_project_objectives` (earlier work).

### 6.2 Per-project data to bring up to date
- **Primary Objective** set to one of the 5 pillars (Innovation work). Legacy
  projects can still be blank; blank ones are **not shown** in the Executive
  view (only counted in its footnote). Complaints/Other are excluded by design.
- **Use case** assigned (admin-managed at `/admin/use-cases`). Assigning a
  project to a use case **overwrites the project's objectives with the use
  case's** and locks them on the project; leaving a use case keeps the last
  values. A project belongs to at most one use case.
- **Supports** and **Benefits** documented.
- **Target Application Deployment Date** set, on a scheduled release Friday
  (every other Friday from 2026-10-09). Off-cycle dates don't appear on the
  Application Release page, and projects with no date fall under Unscheduled in
  the Executive view.
- **Program = Innovation** (the Executive view only shows Innovation).
- **Track and Stage** correct (see 6.3); stage drives delivered/missed logic.
- **Definition of done** re-entered on projects created before the fix.
- **Outcomes** tagged with product (e.g. Cognigy) — needed for the Phase 3
  follow-up suggestion.
- Key-capability flags and quarter, if used.

### 6.3 Tracks and stages
- Tracks D–G (UI/Application, TopicAI, Complaints, Other) were added but have
  **only the three standard stages** (Qualification, Prioritization,
  Productization). Track C is the same. Track A has a full list. **Track B** has
  (2026-10-08): Qualification, Prioritization, Development, Testing, Signoff,
  Integration, Release, **Productization**, then the post-Productization
  stages Services Validation, Services Signoff, Adoption (so those count as
  delivered; see 6.4).
- **Track H - Services Validation** was added (2026-10-08) and also has only
  the three standard stages for now.
- Stage lists are defined **in code** (`TRACK_MIDDLE_STAGES`, and
  `TRACK_POST_STAGES` for stages after Productization, in
  `lib/projects/display.ts`), not in an admin screen — confirm how you intend to
  add stages before assuming otherwise.
- Task templates are per track; the new tracks have none until created.

### 6.4 CRITICAL dependency when adding stages (read before building them)

> **Resolved 2026-10-08 (PR: post-Productization stage support).** The rules
> below now use `hasReachedProductization(track, stage)`
> (`lib/projects/display.ts`), which compares the stage's position with
> Productization's in the track's list, so stages **after** Productization
> are treated as delivered. To add validation/adoption stages, put them in
> `TRACK_POST_STAGES` (same file) for the track — `stagesForTrack` appends
> them after Productization. Marking a project Completed/Canceled no longer
> pulls it back to Productization if it is already past it
> (`closedOutStage`). The text below is the original problem statement.

Several rules treated **"Productization" (`STAGE_LAST`) as the final stage**:
- **Delivered** = release date passed **and** stage is Productization.
- **Missed delivery** = release date passed and stage is **not** Productization.
- Executive phase mapping: Qualification/Prioritization = qualifying;
  Productization = released; everything in between = in progress.
- Marking a project Completed/Canceled **forces the stage to Productization**
  (`lib/projects/service.ts`).

If verification stages (Automated Validation … Adoption) are added **after**
Productization, or Productization is no longer the last stage, a project that
shipped and is in "Adoption" would be flagged **missed delivery** after its
release date. Decide where those stages sit relative to Productization, then
update the rules in `lib/releases/report.ts` (`reachedFinalStage`),
`lib/executive/portfolio.ts` (`phaseOf`), and `lib/projects/service.ts`
accordingly.

## 7. Business rules currently implemented (so I stay consistent)

- **Risk (Application Release and Executive view share one implementation,
  `buildProjectEntries` in `lib/releases/report.ts`):**
  - _Missed delivery:_ release date passed and the project has not reached
    Productization.
  - _Delivered:_ release date passed and the project has reached
    Productization or any stage after it (open tail tasks are normal and not
    flagged).
  - _At risk (before delivery):_ open tasks overdue; status Delayed; or a passed
    planned date (handoff milestone or executable deployment date) still has
    open tasks due by then.
  - Not tied to project status = Completed.
- **Blockers:** blocked project status; blocked/at-risk upstream projects;
  unresolved external dependencies; blocked tasks (naming the blocking
  task/project/reason); tasks waiting on a predecessor.
- **Executive scope:** Innovation program; non-admin; non-canceled; primary
  objective is one of the 5 core pillars. Projects with no pillar are counted
  but not shown.
- **Quarter membership:** by `target_date`; "carried over" only appears under
  the current quarter (earlier-quarter, not yet at Productization).
- **Release calendar:** `lib/releases/calendar.ts`; anchor 2026-10-09, 14-day
  steps; default selection is the first scheduled release on/after today.

## 8. Phase 3 — proposal (not started)

### 8.1 Follow-up rules (auto-generated projects)
- An admin-managed **library of rules**. Each rule: **trigger** (release date —
  the default; reaching Productization; adoption confirmed), **offset in days**,
  **template/track** for the generated project, optional **repeat interval**
  (e.g. 90 days, then 180).
- **Suggested by default** when a project has an outcome tagged Cognigy (90 days
  after release); can be turned off per project; flexible enough for other
  deliverables.
- The existing **daily scheduled job** (`vercel.json` cron; notifications sweep
  infrastructure) creates the project when due: copies pillar, use case and
  lead, links back as "follow-up of", notifies the lead, and never duplicates.
- Needs: a parent/child link on projects, a "generated by rule" flag, a
  follow-up task template (suggest a "bot improvement cycle"), and the rule
  library UI.
- **Open questions:** which template/track the generated project uses; who owns
  it (original lead or someone else); whether the first rule repeats or fires
  once; how it interacts with release-date scheduling.

### 8.2 Artifacts register
- Per-project list of produced artifacts (analysis, presentation, bot,
  dashboard, …) with type, title, link, owner, and a **verified** flag with who
  verified it and when. Types are admin-managed (same mechanism as outcome
  types).
- Could feed verified-vs-unverified counts into the Executive view and deck.
- **Blocked on definitions:** which artifact types, what detail, who verifies,
  and whether a simple flag is enough or a review state is needed.

### 8.3 Verification / adoption (owner-led)
Owner is building the verification stages as track stages with their own
auto-advance logic. Once they exist, consider surfacing the stage rollup
("3 in Human Validation, 1 at Adoption") on the Executive view and in the deck,
and revisit the dependency in 6.4.

### 8.4 Program Coverage view + outcome delivery links (built 2026-10-08; concept under review)

**Status:** steps 1–4 are built and merged (PRs #34–#37). The concept still
needs to be **reviewed with others to confirm it is what's needed** before any
more is built on it — in particular the deck slide (step 5, **on hold**, see
"Still to do" below). Treat the page as a first version to react to, not a
settled design.

Goal: show how the program is executed and where the pieces are — what is
delivered, what is outstanding — less detailed than the other views.

- **Drill-down (URL-driven, as of now) — revised 2026-10-08 around use case
  outcomes:** the third level lists the use case's DEFINED OUTCOMES, each with
  the member projects that support it (the project form's "Use case outcomes
  supported" picks), plus a "projects not linked to an outcome" group. Counts
  and status bars are of use case outcomes. A use case outcome's status rolls
  up from its supporting projects (all delivered -> Delivered; none started or
  no supporter -> Not started + a "no supporting project" flag; otherwise In
  progress); a project's status rolls up its own stage and the delivery of its
  own outcomes, so a shipped dashboard whose bot isn't built is In progress. A
  project's own outcomes (and their delivery projects) sit collapsed under it.
  The original description follows.
- **Drill-down (original description):** five pillars (stacked outcome
  status bar) → a pillar's use cases (matrix: visualization status, outcome
  dots) → a use case (visualization projects, each with its outcomes: text,
  product tag, status, delivery project, expected release).
- **Data:** `ProjectOutcome.delivery` is `{ kind: "self" }` (delivered by the
  project it sits on), `{ kind: "project", project_id }` (another project), or
  null/absent (not yet planned). `self` is a kind, not the project's own ID,
  because a new project has no ID until it is inserted. Delivery projects
  render as leaves (their own outcomes are not expanded, so cycles are
  harmless); status comes from the delivery project's stage: **Delivered** =
  reached Productization or later (Canceled never counts), **In progress** =
  past Prioritization, **Not started** otherwise.
- **Scope:** same as the Executive view (Innovation, non-admin, non-canceled,
  five core pillars), and **projects on Tracks D, E, F, G and H are excluded**
  (`COVERAGE_EXCLUDED_TRACKS` in `lib/coverage/graph.ts`). Only member
  projects are filtered; a project an outcome explicitly names as its delivery
  project is still resolved even if it is on one of those tracks.
- **Counting:** roll up outcomes on use-case member projects only; keep
  delivery projects out of use-case membership. A project that is the delivery
  target of an outcome should count as aligned (not land in the Executive
  view's "no pillar" footnote).
- **Must preserve the link** in `shapeOutcomes` (`lib/projects/service.ts`) and
  in the Markdown import's `buildImportPayload`, or saves/imports will wipe it.
- **Build order:** (1) stage rules / post-Productization support — **done**
  (PR #34); (2) outcome link + "Delivered by" picker — **done** (PR #35;
  `delivery` is `self` / `project` / null, `self` being a kind because a new
  project has no ID yet); (3) pure coverage-graph builder
  (`lib/coverage/graph.ts`, `npm run smoke:coverage`) — **done**; (4) Program
  Coverage page at `/insights/program-coverage` (`?pillar=…&useCase=…`;
  loader `lib/coverage/load.ts`, URL logic `lib/coverage/select.ts`, view
  `components/insights/program-coverage-view.tsx`) — **done**; (5) optional
  deck slide — **ON HOLD pending review of the concept (not started)**.

**Use case outcomes (added 2026-10-08; migration `0040`):** a use case can
define its own outcomes (`UseCase.outcomes`, `{ id, text }`, edited in
Admin → Use cases), and a project picks the ones it supports
(`Project.use_case_outcome_ids`, a "Use case outcomes supported" checklist on
the project form). The checklist shows only the outcomes of the use case the
project belongs to and is **disabled when the project is in no use case**.
Picks are validated on save and reconciled whenever a use case changes (an
outcome removed, or a project moved/removed, drops the stale picks). Separate
from `ProjectOutcome` (what a project itself delivers). **Program Coverage
now aligns projects to these outcomes** (see the drill-down note above); showing
the picks in the project quick view is still open.

**Still to do (not started):**
- **Review the concept with stakeholders** before investing further: are the
  three drill-down levels, the three status buckets (Not started / In progress
  / Delivered) and the level of detail what's needed? Adjust the page from the
  feedback.
- **Deck slide (step 5) — on hold until that review.** Idea: one "Program
  coverage" slide per pillar, use cases as rows and status dots as columns,
  reusing the existing deck pagination/branding (`lib/executive/deck.ts`,
  `lib/export/executive-slides.ts`). Don't build it before the page is
  confirmed.
- **Try the page with real data** (it has only been rendered from sample
  data): a use case with a shared delivery project, one with an outcome that
  has no delivery project, one with a project that has no outcomes.
- **Fill in the data it depends on:** outcomes on every project, each outcome's
  "Delivered by", and use-case membership; the page can only be as complete as
  that data.
- **Small follow-ups, only if the concept holds:** show the delivery link in the
  read-only outcome lists (Work in Progress, Key Capabilities); include it in
  the PROJECT.md export (the importer would then need to ignore/read it so
  outcome matching isn't thrown off); show the Import-from-Markdown button
  outside the Projects table (Work in Progress and Roadmap don't pass
  `onProjectImported`).

## 9. Related work built in the same period (context, not phases)

- **Use cases** (PR #24; migrations 0034/0035): admin-defined, name +
  description, required primary + optional secondary objectives, individually
  assigned projects (one use case per project; a project can be **moved**
  between use cases). Admin-only via `usecases.manage`. Projects inherit
  objectives (PR #25, migration 0038).
- **Tracks D–G** added (PR #24).
- **Application Release page** (PR #25 and follow-ups #27/#28): `/insights/
  application-release`, below Work in progress. Rows per project with stage,
  primary objective, use case, planned dates, progress, blockers and risk.
  **Release caveats** (migration 0037): per-project, per-release notes with
  author/date, add/edit/delete inline (`projects.edit`), audited on the project.
- **PROJECT.md export** now includes Program, objectives, use case, key
  capability (PR #26) and Supports/Benefits sections (PR #30).
- **Admin bulk delete of tasks** (PR #29): `tasks.bulk_delete`, Admin-only by
  default, on the Tasks page.

## 10. Known limitations / things to remember

- Deleting tasks (single or bulk) does **not** clean up other tasks'
  dependency/blocker references to them; they show as "not found".
- The Roadmap page's project form does not show the "objectives inherited from
  use case" note; the server still rejects diverging edits with a message.
- Release caveats stay with the release date they were written for; if a
  project's date moves, they don't follow it. They only show on the Application
  Release page (not the project quick view).
- Projects with off-cycle target dates are not visible on the Application
  Release page.
- The deck was verified with **sample data only**; the Download deck button has
  not been exercised against real data.
- Use-case objective changes sync to member projects when the use case is
  saved; projects removed from a use case keep their last objectives.
- `.claude/settings.local.json` has long-standing uncommitted local edits
  (including an allow rule for `rm *`); it has been intentionally left out of
  every commit.
- Lesson learned: Next.js route files may only export handlers/config. Always
  run a real `next build` (not just `tsc`) before opening a PR.

## 11. Key files

| Area | Files |
|---|---|
| Executive view | `app/insights/executive/page.tsx`, `components/insights/executive-view.tsx`, `lib/executive/portfolio.ts`, `lib/executive/load.ts` |
| Deck export | `lib/executive/deck.ts`, `lib/export/executive-slides.ts`, `components/insights/executive-deck-modal.tsx`, `app/api/export/executive-deck/route.ts` |
| Risk / blockers / release | `lib/releases/report.ts`, `lib/releases/calendar.ts`, `app/insights/application-release/page.tsx`, `components/insights/application-release-view.tsx` |
| Release caveats | `lib/releases/caveats-service.ts`, `lib/db/release-caveats.ts`, `app/api/release-caveats/` |
| Use cases | `lib/use-cases/service.ts`, `lib/db/use-cases.ts`, `components/admin/use-cases-admin.tsx`, `app/admin/use-cases/page.tsx` |
| Tracks / stages | `lib/projects/display.ts` (`SYSTEM_TRACKS`, `TRACK_MIDDLE_STAGES`, `STAGE_*`) |
| Objectives | `OBJECTIVES`, `SECONDARY_OBJECTIVE_OPTIONS` in `lib/projects/display.ts` |
| Smoke tests | `npm run smoke:executive`, `smoke:executive-deck`, `smoke:release` |

## 12. Suggested first steps when resuming

1. Confirm migrations 0033–0039 have been run.
2. Review the checklist in section 6 against your projects; open the Executive
   view and the footnote count to see what is still unaligned.
3. Decide where the new verification stages sit relative to Productization and
   update the section 6.4 rules together with the track stage lists.
4. Run the deck against real data and note any layout or wording changes.
5. Then start Phase 3 with **follow-up rules** (Cognigy, 90 days, anchored on the
   release date); answer the section 8.1 questions first.
