/**
 * Generates `Praxis_Application_Design_Requirements_v2.docx` at the
 * project root. Reads the v1 .docx as a template (to inherit its
 * styles.xml / fontTable.xml / numbering.xml etc.) and replaces the
 * `word/document.xml` body with v2 content.
 *
 * Run with:
 *   npx tsx scripts/generate-design-doc-v2.ts
 *
 * The content array below is the source of truth for the document
 * body; styles map to the same names v1 uses (Heading1, Heading2,
 * Heading3, ListParagraph). Edit `paragraphs` to revise.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
// JSZip is a transitive dep (via pptxgenjs); we import it directly
// to avoid adding a top-level dependency just for one generator.
import JSZip from "jszip";

type Style =
  | "Title"
  | "Subtitle"
  | "Heading1"
  | "Heading2"
  | "Heading3"
  | "Normal"
  | "ListParagraph";

interface Para {
  style: Style;
  text: string;
}

// ---------------------------------------------------------------------------
// Document body — Praxis design requirements, v2.
// ---------------------------------------------------------------------------

const paragraphs: Para[] = [
  { style: "Normal", text: "" },
  { style: "Normal", text: "" },
  { style: "Title", text: "Praxis" },
  { style: "Subtitle", text: "Design Document & Implementation Requirements" },
  { style: "Normal", text: "" },
  { style: "Normal", text: `Version 2.1  |  May 2026` },
  { style: "Normal", text: "" },
  { style: "Normal", text: "Supersedes the April 2026 v1.0 Innovation Initiative Management (IIM) Application Design Document. The application has since been renamed Praxis, migrated from a JSON file store to a Supabase Postgres database, moved auth from NextAuth to Supabase Auth, deployed to Vercel, and integrated AWS Bedrock for the three AI Advisor features (complexity estimate, priority recommendation, idea overlap). This document reflects the as-built state of the application as of mid-May 2026." },
  { style: "Normal", text: "" },

  // -------------------------------------------------------------- 1
  { style: "Heading1", text: "1. Executive Summary" },
  { style: "Normal", text: "Praxis is a lightweight, purpose-built platform for tracking, managing, and prioritizing innovation projects, tasks, and submitted ideas within a single team. It replaces a spreadsheet-based workflow with a structured web application that is fast to use day-to-day and provides multiple roadmap views, role-based access control, an open public idea-submission portal, an audit trail, project and resource health analytics, and a Lyra-aligned visual layer." },
  { style: "Normal", text: "The original v1 design assumed a JSON file store with an abstraction layer that would let the team swap to a database later. That swap has happened: Praxis now runs on Supabase Postgres in production and is hosted on Vercel, with a daily Vercel Cron job driving notification sweeps. The repository pattern from v1 is intact — every page, component, and API route continues to read and write through lib/db/* — and the swap proved out the v1 architectural decision exactly as planned." },
  { style: "Normal", text: "The AI Advisor features (complexity scoring, priority recommendation, idea overlap) are live in local development against AWS Bedrock. Each feature uses an admin-selectable model from the live Bedrock model list, persisted in settings.ai_config. AI features are intentionally OFF in production: Bedrock authentication uses IAM Identity Center SSO which cannot be refreshed in the Vercel serverless runtime. Production credential strategy is open." },

  // -------------------------------------------------------------- 2
  { style: "Heading1", text: "2. Guiding Principles" },
  { style: "ListParagraph", text: "Lightweight over heavy: optimize for speed of use and ease of daily adoption, not feature completeness for edge cases." },
  { style: "ListParagraph", text: "Data fields over labels: use structured fields to power filtering, AI analysis, and reporting — not free-form tags." },
  { style: "ListParagraph", text: "AI-assisted, not AI-dependent: AI recommendations are advisory; humans make final decisions." },
  { style: "ListParagraph", text: "Open submission, controlled promotion: anyone can submit an idea via /submit; only authorized users can review and promote it." },
  { style: "ListParagraph", text: "Storage-agnostic: all data access still routes through lib/db/*. The current implementation calls Supabase via the @supabase/supabase-js client; swapping to a different Postgres host or another database is a contained change at this layer only." },
  { style: "ListParagraph", text: "Single-tenant by design: Praxis is built for one team. There is no workspace switcher, no per-tenant data isolation, and no multi-org permission scoping. Role-based access is enforced inside that single tenant." },
  { style: "ListParagraph", text: "Integration-ready: github_issue_id and jira_issue_id columns exist on every project and task record from Day 1. No sync code is built yet; the architecture is ready when the team decides to wire one in." },

  // -------------------------------------------------------------- 3
  { style: "Heading1", text: "3. Application Overview" },

  { style: "Heading2", text: "3.1 Technology Stack (As Built)" },
  { style: "ListParagraph", text: "Next.js 15.5 (App Router) with TypeScript and React 18." },
  { style: "ListParagraph", text: "Tailwind CSS 3.4 for utility styling; a hand-authored Polaris/Lyra CSS layer in app/polaris.css for design tokens, primitives, and Lyra-aligned visual treatments (rounded surfaces, soft shadow, neutral canvas, pill chips, focus rings)." },
  { style: "ListParagraph", text: "Supabase Postgres as the system of record for all entities (projects, tasks, ideas, users/profiles, notifications, decisions, templates, audit log, settings). Row Level Security enabled on every table; server-side calls use the service-role key and bypass RLS. The browser does not talk to Postgres directly today." },
  { style: "ListParagraph", text: "Supabase Auth for identity (sign-in, OTP-based recovery, invite, password reset). The browser uses @supabase/ssr's createBrowserClient so session cookies stay in sync with the server. Middleware refreshes the access token on every request." },
  { style: "ListParagraph", text: "Resend (transactional email provider) installed for future use. Today, invitation and password-recovery emails are sent by Supabase's built-in email layer; per-event in-app notifications are persisted to the database but not yet emailed." },
  { style: "ListParagraph", text: "AWS SDK for Bedrock (@aws-sdk/client-bedrock, @aws-sdk/client-bedrock-runtime, @aws-sdk/credential-providers). Credentials are resolved via the SDK's default Node provider chain, picking up an SSO profile from ~/.aws/config so temporary credentials refresh transparently during local dev." },
  { style: "ListParagraph", text: "pptxgenjs + html2canvas for PowerPoint export of any roadmap view." },
  { style: "ListParagraph", text: "ExcelJS for spreadsheet import (initial seed and ongoing imports from the New Project Ideas tab)." },
  { style: "ListParagraph", text: "Vercel for hosting (serverless functions, edge middleware). Vercel Cron drives one scheduled job: a daily notifications sweep at 07:00 UTC." },

  { style: "Heading2", text: "3.2 Deployment Topology" },
  { style: "ListParagraph", text: "Production runs on Vercel. The Next.js app is deployed as serverless functions for routes and edge middleware for the auth gate." },
  { style: "ListParagraph", text: "All persistent state lives in Supabase (Postgres + Auth). No filesystem state is required on Vercel — the JSON-file regime from v1 has been retired in production." },
  { style: "ListParagraph", text: "Required environment variables (production and local): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL (used for password-reset and invite link callbacks), CRON_SECRET (bearer token validated by the daily sweep endpoint), and optionally RESEND_API_KEY for future transactional email." },
  { style: "ListParagraph", text: "Local-dev-only environment variables for the AI Advisor: AI_ENABLED=true to turn the features on, AWS_PROFILE=<sso-profile-name> for credential refresh from the SSO cache, BEDROCK_REGION=<region> for the Bedrock service-call region (independent of the SSO region inside the profile). None of these are set in production." },
  { style: "ListParagraph", text: "Vercel Cron is defined in vercel.json; the only scheduled job is POST /api/admin/notifications/sweep at 07:00 UTC, which fires due-soon, overdue, and health-change notifications and recalculates project health for projects whose tasks changed." },
  { style: "ListParagraph", text: "The middleware allow-lists /api/admin/notifications/sweep so the cron's Bearer-token auth handler runs instead of the session-cookie gate." },

  { style: "Heading2", text: "3.3 Storage Architecture (As Built)" },
  { style: "Normal", text: "Every page, API route, and service still goes through the repository abstraction in lib/db/. The v1 JSON file implementation has been replaced behind that interface with a Supabase implementation; no caller changed." },

  { style: "Heading3", text: "File Structure" },
  { style: "ListParagraph", text: "lib/db/types.ts — TypeScript interfaces for every entity (Project, Task, ProjectIdea, User, Notification, DecisionLogEntry, TaskTemplate, AuditLogEntry, AppSettings) and the shared enums/embedded shapes (DocumentLink, ProjectDependency, ExternalDependency, StatusHistoryEntry, TaskCommentEntry, HealthScoreSnapshot, ResourceSettings, etc.)." },
  { style: "ListParagraph", text: "lib/db/projects.ts, tasks.ts, ideas.ts, users.ts, notifications.ts, decisions.ts, templates.ts, audit-log.ts, settings.ts — one repository module per entity. Each exports a frozen object with async getAll/getById/create/update/delete (and entity-specific helpers such as getByProjectId for tasks and decisions, getByEmail for users, markRead for notifications)." },
  { style: "ListParagraph", text: "lib/db/store.ts — Supabase client accessors used by every repository. Wraps `createClient` from @supabase/supabase-js with the service-role key for the server runtime and provides newUuid / nowIso utilities." },
  { style: "ListParagraph", text: "lib/db/index.ts — re-exports all repositories and types; the only import callers use." },
  { style: "ListParagraph", text: "supabase/migrations/ — SQL migrations applied to the Supabase project. The set as of v2 is: 0001_initial_schema.sql (mirrors lib/db/types.ts), 0002_drop_legacy_auth_columns.sql (drops password_hash / invite_token / reset-token columns from public.users after the Supabase Auth handoff), 0003_external_dependencies.sql (adds the external_dependencies jsonb column to projects)." },
  { style: "ListParagraph", text: "lib/supabase/server.ts, request.ts, client.ts — three thin client factories. server.ts is the service-role client used by repositories and any code that must bypass RLS. request.ts is a per-request cookie-aware client used by middleware and SSR routes that need to read the signed-in user. client.ts is the browser-side createBrowserClient used by login/forgot-password/reset-password forms so the browser shares cookies with the server." },

  { style: "Heading3", text: "Repository Pattern" },
  { style: "Normal", text: "The repositories are plain frozen objects with async functions; signatures match the v1 contract exactly. Example for projects:" },
  { style: "Normal", text: "  ProjectRepository.getAll(): Promise<Project[]>" },
  { style: "Normal", text: "  ProjectRepository.getById(id): Promise<Project | null>" },
  { style: "Normal", text: "  ProjectRepository.create(input): Promise<Project>" },
  { style: "Normal", text: "  ProjectRepository.update(id, patch): Promise<Project>" },
  { style: "Normal", text: "  ProjectRepository.delete(id): Promise<void>" },
  { style: "Normal", text: "The Supabase implementation translates each call into a PostgREST query, applies the appropriate row-level shape transformation (string[] columns, jsonb columns), and returns the same TypeScript record shapes v1 produced. ID generation for projects (YYYY-NNN) and tasks (YY-NNNN) is done in Postgres via the public.next_project_id() and public.next_task_id() functions defined in 0001_initial_schema.sql, using pg_advisory_xact_lock per year/short-year to serialize concurrent inserts." },

  { style: "Heading3", text: "Validators and Service Layer" },
  { style: "Normal", text: "Beyond the repositories, each major entity has a service module under lib/<entity>/service.ts that performs validation, fires audit-log entries, sends notifications, and enforces cross-record invariants (circular-dependency detection, auto-unblock cascades, etc.). API routes are thin and forward to these service functions." },
  { style: "ListParagraph", text: "lib/projects/service.ts — project CRUD, dependency validation (Section 5.10), external dependency validation (Section 5.11), status history append, health recompute, audit emission. Calls validateDependencies and validateExternalDependencies before persisting." },
  { style: "ListParagraph", text: "lib/tasks/service.ts — task CRUD, comment history append, audit emission. unblockDependentTasks() automatically clears the blocker on any task with blocker_task_id pointing at a task that just transitioned to Complete (Section 5.10.1)." },
  { style: "ListParagraph", text: "lib/ideas/service.ts — idea CRUD, conversion-to-project workflow." },
  { style: "ListParagraph", text: "lib/decisions/service.ts — append-only decision-log entries." },
  { style: "ListParagraph", text: "lib/notifications/service.ts — createNotification, per-user fan-out for project/task/idea events. Honors the recipient's notification_preferences (per-type Off / InAppOnly / EmailAndInApp), but email delivery is not yet wired." },
  { style: "ListParagraph", text: "lib/audit/service.ts — recordAudit() entry point; summarizeChanges() helper turns a before/after pair into the human-readable summary cell. Every create/update/delete in every other service routes through here." },

  // -------------------------------------------------------------- 4
  { style: "Heading1", text: "4. Data Model" },

  { style: "Heading2", text: "4.1 Projects" },
  { style: "Normal", text: "Project IDs follow the YYYY-NNN convention from v1 (e.g., 2026-001). They are allocated atomically by public.next_project_id() inside the database transaction that inserts the row. Fields stored on each project (see lib/db/types.ts Project):" },
  { style: "ListParagraph", text: "Identity & narrative: name, description, application_product, project_type, date_added, priority, status, phase, primary_stakeholders, project_lead, additional_resources, resource_allocations (per-resource percent of time allocated)." },
  { style: "ListParagraph", text: "Timing: target_date, roadmap_timeline_start (the planned/actual start date; the system auto-fills it when status leaves Not Started and the field is null)." },
  { style: "ListParagraph", text: "AI placeholders: ai_complexity_score (Low/Medium/High/Very High), ai_time_estimate (free-form, e.g., '4-6 weeks')." },
  { style: "ListParagraph", text: "Roadmap: roadmap_bucket (free-form, used for Kanban and Now/Next/Later)." },
  { style: "ListParagraph", text: "Integration placeholders: github_issue_id, jira_issue_id." },
  { style: "ListParagraph", text: "Health: health_score (Red/Yellow/Green), health_score_history (rolling ~30 snapshots)." },
  { style: "ListParagraph", text: "Status history: status_history, an append-only log of every status change (timestamp, previous status, actor, optional summary note)." },
  { style: "ListParagraph", text: "Dependencies: depends_on (mirror of upstream IDs), dependencies (full ProjectDependency rows with type and required_phase), external_dependencies (Section 5.11)." },
  { style: "ListParagraph", text: "Other: document_links (Section 5.14), custom_fields (Section 5.19), created_by, updated_at." },

  { style: "Heading2", text: "4.2 Tasks" },
  { style: "Normal", text: "Task IDs follow the YY-NNNN convention from v1 (e.g., 26-0001) and are allocated atomically by public.next_task_id(). Tasks have a hard FK to their parent project; on project delete, tasks are cascaded. Fields:" },
  { style: "ListParagraph", text: "Identity & narrative: project_id, task_name, detailed_description, status, priority, responsible, additional_assignees." },
  { style: "ListParagraph", text: "Timing: target_date, estimate_hours (optional, decimal hours)." },
  { style: "ListParagraph", text: "Blocking: blocked, blocker_issue_task (free-text), blocker_type ('task' | 'project' | 'other'), blocker_task_id, blocker_project_id. The form modal switches the picker based on blocker_type." },
  { style: "ListParagraph", text: "Comments: comments (latest), comment_history (append-only log of changes with before/after text and actor)." },
  { style: "ListParagraph", text: "Other: document_links, template_id (set when the task was instantiated from a template), created_at, updated_at." },

  { style: "Heading2", text: "4.3 Task Templates" },
  { style: "Normal", text: "Templates define an ordered set of TaskTemplateItem entries (name, description, default_priority). Templates are associated with a project_type and offered for auto-application when a new project of that type is created. Stored in the templates table; managed by Admin → Templates." },

  { style: "Heading2", text: "4.4 Decision Log" },
  { style: "Normal", text: "Per-project log of decisions made (scope changes, priority changes, timeline changes, resource changes, technical decisions, other). Entries are immutable after creation and append-only. Stored in the decisions table with a FK to projects; cascaded on project delete. Distinct from the system Audit Log (Section 5.20), which tracks field-level changes; the Decision Log captures human reasoning." },

  { style: "Heading2", text: "4.5 Notifications" },
  { style: "Normal", text: "One row per notification per recipient, with type, message, entity_type (Project | Task | Idea), entity_id, and a read flag. Indexed by user_id and read for efficient unread-count queries in the notification bell. Notification types: TaskAssigned, TaskDueSoon, TaskOverdue, ProjectBlocked, DependencyBlocked, HealthScoreChanged, IdeaStatusChanged." },

  { style: "Heading2", text: "4.6 Project Ideas (Public Submissions)" },
  { style: "Normal", text: "Submitted via the public /submit page; stored with submitter_name (required), submitter_email (optional), idea_name, description, urgency, requested_target_date, key_stakeholders, status (New | Under Review | Approved | Rejected | Converted), admin_comments, converted_to_project_id, and ai_overlap_analysis (a cached AI overlap summary, currently null since AI is paused)." },

  { style: "Heading2", text: "4.7 Users & Roles" },
  { style: "Normal", text: "Identity (email, password, invitation tokens, recovery tokens) lives in Supabase Auth (auth.users) — Praxis no longer stores password hashes or invite tokens in its own schema. The public.users table is now a profile mirror keyed by the same user_id as auth.users, holding only the app-specific fields the rest of the system reads: name, role (Admin | Project Lead | Team Member | Viewer), active, notification_preferences, digest_mode. Migration 0002 dropped the legacy password/invite/reset columns once the Supabase Auth handoff was complete." },
  { style: "Normal", text: "Role permissions are not hard-coded. The settings.role_permissions map (RolePermissionsMap) is editable by Admins via Admin → Roles & permissions, lets each non-Admin role be granted or denied individual permission keys, and is normalized on read against the documented catalog so a hand-edited settings record cannot crash the app. Admin always has every permission, regardless of what is stored." },

  // -------------------------------------------------------------- 5
  { style: "Heading1", text: "5. Application Pages & Features" },

  { style: "Heading2", text: "5.1 Projects Page (/projects)" },
  { style: "ListParagraph", text: "Default view filters to open projects (Not Started, In Planning, In Progress, Blocked, On Hold, Delayed). Status, Phase, Priority, Project Type, Project Lead, Application/Product, and Target Date range are all filterable; sortable by any column." },
  { style: "ListParagraph", text: "Strategic position bucket badge (Quick Win, Major Bet, Fill-In, Deprioritize) is shown alongside the health badge and is derived from priority × ai_complexity_score. Labels are admin-customizable via Admin → Portfolio quadrants without changing bucket assignment." },
  { style: "ListParagraph", text: "Inline status update without opening the full record; click any row to open the slide-out quick-view panel; bulk actions for status, lead, and priority across multiple selected rows." },
  { style: "ListParagraph", text: "Export to CSV/Excel of the current filtered view via /api/projects/export." },
  { style: "ListParagraph", text: "Health Score badge (Red/Yellow/Green) on every row, recalculated whenever a task or project field changes (Section 5.13)." },
  { style: "ListParagraph", text: "New Project button opens the create modal; the description field is wired to call the AI Complexity endpoint when AI is enabled." },

  { style: "Heading2", text: "5.2 Tasks Page (/tasks)" },
  { style: "ListParagraph", text: "Default view: open tasks across all projects." },
  { style: "ListParagraph", text: "Visual callouts: color-coded rows for Blocked, Past Due, Due This Week, On Track." },
  { style: "ListParagraph", text: "Filters: Status, Priority, Project, Responsible, Blocked flag, Due Date range." },
  { style: "ListParagraph", text: "Group by Project, Responsible, Status, or Priority." },
  { style: "ListParagraph", text: "Add/edit modal with all fields including the blocker picker that switches between task picker, project picker, and free-text based on blocker_type." },

  { style: "Heading2", text: "5.3 My Tasks Page (/my-tasks)" },
  { style: "ListParagraph", text: "Server-side filtered to the currently signed-in user (responsible = currentUser)." },
  { style: "ListParagraph", text: "Same filtering and visual callouts as the Tasks page." },
  { style: "ListParagraph", text: "Grouped by Project by default; blocked tasks pinned to the top." },

  { style: "Heading2", text: "5.4 Roadmap — Timeline View" },
  { style: "ListParagraph", text: "Gantt-style horizontal timeline. Bars run from roadmap_timeline_start (or date_added when start is null) to target_date." },
  { style: "ListParagraph", text: "Bars colored by Status or Priority (user toggle)." },
  { style: "ListParagraph", text: "Click a bar to open the project quick view." },
  { style: "ListParagraph", text: "Dependency connector arrows between linked projects, colored by upstream project status (Section 5.10)." },
  { style: "ListParagraph", text: "Filterable by Project Type, Priority, Application/Product, Project Lead; PNG/PDF export via the PPTX flow (Section 5.9)." },

  { style: "Heading2", text: "5.5 Roadmap — Kanban View" },
  { style: "ListParagraph", text: "Configurable columns: any of Status, Phase, Priority, or roadmap_bucket can define columns. Optional swimlanes group rows by a second field." },
  { style: "ListParagraph", text: "Card content: Project ID, Name, Priority indicator, Project Lead, Target Date, Task count." },
  { style: "ListParagraph", text: "Drag-and-drop to move a card between columns updates the underlying field." },
  { style: "ListParagraph", text: "WIP limits per column (optional)." },
  { style: "ListParagraph", text: "Multiple saved Kanban configurations (settings.kanban_configs) so users can keep e.g. 'By Phase' and 'By Priority' side-by-side without rebuilding." },

  { style: "Heading2", text: "5.6 Roadmap — Portfolio Bubble Chart" },
  { style: "ListParagraph", text: "Default axes: X = AI Complexity Score, Y = Priority; bubble size = estimated duration." },
  { style: "ListParagraph", text: "Quadrant labels are pulled from settings.portfolio_quadrants and are editable in Admin → Portfolio quadrants (Quick Win / Major Bet / Fill-In / Deprioritize by default)." },
  { style: "ListParagraph", text: "Click a bubble to open the project quick view. Filtered projects are hidden from the chart." },

  { style: "Heading2", text: "5.7 Roadmap — Now / Next / Later View" },
  { style: "ListParagraph", text: "Three fixed columns: Now, Next, Later. Auto-placement is driven primarily by roadmap_timeline_start (start ≤ ~14d → Now; ≤ ~90d → Next; else Later); falls back to status + target date when start is missing. User can override placement by dragging." },
  { style: "ListParagraph", text: "Card content: Project Name, Priority badge, Application/Product, Project Lead, Target Date." },
  { style: "ListParagraph", text: "Drag-and-drop updates roadmap_bucket; an 'Unplaced' overflow lane catches projects without a bucket assignment." },

  { style: "Heading2", text: "5.8 Roadmap — Capacity / Resource View" },
  { style: "ListParagraph", text: "Y-axis: team members across all active projects (Project Lead + Additional Resources). X-axis: configurable time window." },
  { style: "ListParagraph", text: "Each active project assignment renders as a bar; cells where a resource exceeds their allocation threshold are highlighted." },
  { style: "ListParagraph", text: "Click any bar to open the project quick view; click a person row label to open Insights → Resources detail for that user." },

  { style: "Heading2", text: "5.9 Roadmap — PPTX Export" },
  { style: "Normal", text: "Any roadmap view can be exported to a .pptx slide deck via POST /api/export/pptx. Server-side rendering uses pptxgenjs. Roadmap visualizations are captured client-side with html2canvas at 2× pixel ratio, base64-encoded, and embedded as high-resolution images; Now/Next/Later and Projects Status slides are generated natively with pptxgenjs text and shapes so text stays selectable in PowerPoint." },
  { style: "ListParagraph", text: "Slide picker lets the user choose which slide types to include before export." },
  { style: "ListParagraph", text: "Filter inheritance: active roadmap filters apply to the slides." },
  { style: "ListParagraph", text: "Branding (logo, primary color, secondary color, font) is read from settings.branding and applied to the slide master." },
  { style: "ListParagraph", text: "Output filename: Praxis_Roadmap_YYYY-MM-DD.pptx." },

  { style: "Heading2", text: "5.10 Project Dependencies" },
  { style: "ListParagraph", text: "Depends On selector on the project form lets a user pick one or more upstream Praxis projects." },
  { style: "ListParagraph", text: "Dependency type: Blocks Start or Blocks Phase (with a required_phase when the latter)." },
  { style: "ListParagraph", text: "Circular dependency detection at save time, implemented in the project service using a depth-first traversal across the current dependency graph." },
  { style: "ListParagraph", text: "Timeline view renders dependency arrows between connected bars, colored by upstream status." },
  { style: "ListParagraph", text: "Dependency chain panel on the project record shows the full upstream chain." },
  { style: "ListParagraph", text: "depends_on and dependencies are stored on the dependent project itself (not a join table); deleting an upstream project automatically prunes references on every dependent project." },

  { style: "Heading3", text: "5.10.1 Auto-Unblock on Task Complete" },
  { style: "Normal", text: "When a task transitions to Complete, lib/tasks/service.ts looks up every other task in the system whose blocker_task_id points at the just-completed task. For each match it clears blocked, blocker_task_id, and blocker_issue_task; if the dependent task's own status was Blocked it is reset to Not Started so the user has to actively decide whether to start it now or leave it parked. This prevents the common 'I marked the blocker done but everyone downstream still shows Blocked' problem and removes a manual cleanup step." },

  { style: "Heading2", text: "5.11 External Dependencies (new in v2)" },
  { style: "Normal", text: "Projects often wait on functionality in tools or by teams that Praxis doesn't own — a Jira ticket in another team's project, a vendor delivery, a SaaS feature request. The external_dependencies array on each project record captures these so the project's status accurately reflects the wait." },
  { style: "ListParagraph", text: "Fields per entry: external_dependency_id (UUID), label, description, owner (team/person/vendor), url (optional tracking link), status (Open / In Progress / Resolved), target_date, created_at, created_by, resolved_at." },
  { style: "ListParagraph", text: "Edited from a dedicated panel in the project quick-view; quick-add at the bottom of the panel for fast entry, full inline editor per row." },
  { style: "ListParagraph", text: "resolved_at is auto-stamped the first time status flips to Resolved; cleared if it ever goes back to Open or In Progress so the next flip records a fresh timestamp." },
  { style: "ListParagraph", text: "Validation lives in lib/projects/external-dependencies.ts and is called from the project service before write. Stored as a flexible jsonb column on public.projects so older records read cleanly and new optional fields can be added without a migration." },

  { style: "Heading2", text: "5.12 Decision & Change Log" },
  { style: "ListParagraph", text: "Decision Log tab on every project detail/quick-view panel." },
  { style: "ListParagraph", text: "Add-entry form: Date, Decision Type, Summary, Rationale, Made By." },
  { style: "ListParagraph", text: "Entries are immutable once saved; displayed newest-first. Decision types render as colored badges." },
  { style: "ListParagraph", text: "Filter by Decision Type or date range. Decision log content participates in global search (Section 5.21)." },
  { style: "ListParagraph", text: "Distinct from the system Audit Log (Section 5.20), which captures field changes; the Decision Log captures human reasoning." },

  { style: "Heading2", text: "5.13 Notifications & Alerts" },
  { style: "Normal", text: "Notification types implemented: TaskAssigned, TaskDueSoon, TaskOverdue, ProjectBlocked, DependencyBlocked, HealthScoreChanged, IdeaStatusChanged. Per-user preferences for each type are Off, In-App Only, or Email + In-App; users edit their preferences from /profile/notifications. Org-wide defaults are configurable from Admin → Notifications." },
  { style: "Heading3", text: "Delivery Channels" },
  { style: "ListParagraph", text: "In-app: the notification bell in the top bar shows the unread count; clicking opens a drawer with recent notifications, each markable as read. Polls on a short interval." },
  { style: "ListParagraph", text: "Email: Resend is installed and ready, but transactional email for per-event notifications is not yet wired. Today, invite and password-recovery emails are sent by Supabase Auth's built-in email layer. Per-event and digest email delivery for application notifications is planned but not in production." },
  { style: "Heading3", text: "Scheduled Sweep" },
  { style: "ListParagraph", text: "A Vercel Cron job hits POST /api/admin/notifications/sweep every day at 07:00 UTC, authenticated by the CRON_SECRET bearer token (matched against the same env var on the route handler)." },
  { style: "ListParagraph", text: "On each run the sweep: scans tasks for due-soon (within configurable lead time, default 3 days) and overdue; recalculates affected projects' health scores; fires HealthScoreChanged notifications when a score degrades; fires DependencyBlocked notifications when an upstream Praxis dependency turns Red." },
  { style: "ListParagraph", text: "Local equivalent: scripts/run-notifications-sweep.ts can be run manually against a local database, useful for development verification without waiting for the cron." },

  { style: "Heading2", text: "5.14 Project Health Score" },
  { style: "Normal", text: "Health is computed by lib/health from the same inputs v1 specified: percent of tasks blocked-or-overdue, time remaining to target date, last task activity, and the status of upstream Praxis dependencies. Thresholds are stored in settings.health_score_thresholds and editable from Admin → Health thresholds." },
  { style: "ListParagraph", text: "Green: < yellow_blocked_or_overdue_pct (default 20%) of tasks blocked/overdue AND target date not imminent AND at least one task touched in the last 7 days." },
  { style: "ListParagraph", text: "Yellow: between yellow and red percent thresholds; OR target date within yellow_target_date_proximity_days with > yellow_open_tasks_pct open; OR no task activity in 14+ days; OR ≥ yellow_due_soon_tasks_pct of open tasks have target dates falling within the proximity window." },
  { style: "ListParagraph", text: "Red: ≥ red_blocked_or_overdue_pct of tasks blocked/overdue; OR target date passed and status is not Completed; OR status is Blocked; OR an upstream dependency is Red." },
  { style: "ListParagraph", text: "Recomputed on every task or project change and during the daily sweep; latest value is persisted to projects.health_score for cheap reads, with the rolling 30-snapshot history kept in projects.health_score_history for the sparkline on the project record." },
  { style: "ListParagraph", text: "POST /api/admin/health-thresholds/recalculate triggers a full recompute for every project (useful after threshold edits)." },

  { style: "Heading2", text: "5.15 Document & Repository Links" },
  { style: "ListParagraph", text: "Project and task records both carry a document_links array. Supported link types: GitHub Repo, GitHub PR, Confluence, Network Drive, SharePoint, Figma, Miro, Jira Issue, External, Other." },
  { style: "ListParagraph", text: "Edited from a dedicated panel; quick-add lets the user paste a URL and the form attempts to auto-detect the link type by domain." },
  { style: "ListParagraph", text: "Link labels are visible in the quick-view and participate in global search." },

  { style: "Heading2", text: "5.16 Velocity & Throughput Dashboard (/dashboard/velocity)" },
  { style: "Normal", text: "Historical analytics computed entirely from existing project/task data. Server-side metrics are cached briefly per filter/time-window combination to avoid recomputing on every page load." },
  { style: "ListParagraph", text: "Projects Completed per Quarter (bar chart, filterable by Project Type and Application/Product)." },
  { style: "ListParagraph", text: "Average Time to Completion (mean days from creation to Completed) by Project Type, with a trend line over time." },
  { style: "ListParagraph", text: "Estimated vs. Actual Duration (scatter; reveals AI estimate accuracy once AI is wired)." },
  { style: "ListParagraph", text: "Task Throughput (rolling weekly count of completed tasks)." },
  { style: "ListParagraph", text: "Phase Cycle Time (average days in each phase from Qualification through Closeout)." },
  { style: "ListParagraph", text: "Blocked Time (days spent in Blocked status per quarter)." },
  { style: "ListParagraph", text: "Idea Conversion Rate (percent of submitted ideas that became projects)." },
  { style: "ListParagraph", text: "Time range selector (30d, 90d, 6mo, 1yr, all, custom) and filters for Project Type / Application/Product / Project Lead." },

  { style: "Heading2", text: "5.17 Insights → Resources (/insights/resources, /insights/resources/[user_id])" },
  { style: "Normal", text: "Resource-focused analytics distinct from the Capacity roadmap view. Surfaces who is over/under-allocated and how each contributor is performing on the work they own." },
  { style: "ListParagraph", text: "List page: every contributor across projects with their workload bucket (Light / Balanced / Heavy / Overloaded) and performance score (Red / Yellow / Green)." },
  { style: "ListParagraph", text: "Detail page: per-user breakdown — assignment list, open task count, past-due count, bottleneck count (tasks blocking other people), and the inputs that drove the workload/performance score." },
  { style: "ListParagraph", text: "Workload weights and bucket thresholds are not hard-coded; settings.resource_settings holds tunable weights (project assignment, open task, past-due, bottleneck, complexity multipliers, priority multipliers) plus the bucket cutoffs and the on-time-rate / blocked-rate weights for performance. Editable from Admin → Resource thresholds." },

  { style: "Heading2", text: "5.18 AI Advisor" },
  { style: "Normal", text: "Three AI features are live in local development against AWS Bedrock. They are gated behind the AI_ENABLED feature flag and intentionally OFF in production (Vercel cannot refresh the IAM Identity Center SSO credentials that Bedrock authentication currently requires). Each feature reads its model selection from settings.ai_config; an admin chooses which Bedrock model each feature uses without a code change." },

  { style: "Heading3", text: "5.18.1 Complexity & Time Estimate" },
  { style: "ListParagraph", text: "Triggered by the 'Generate AI estimate' button under the description field on the project form modal. Sends the description + project_type to POST /api/ai/estimate." },
  { style: "ListParagraph", text: "Returns: { complexity: Low | Medium | High | Very High, time_estimate: free-form range string, rationale: 1-3 sentences }." },
  { style: "ListParagraph", text: "Result populates the AI Suggestion banner inline (complexity tier + time estimate + rationale). On Save, complexity and time_estimate are persisted to the project record (ai_complexity_score, ai_time_estimate); rationale is transient advisory copy and not persisted." },
  { style: "ListParagraph", text: "Default model: anthropic.claude-3-haiku-20240307-v1:0 (single-region on-demand). The high call volume makes a small, cheap model the right default." },

  { style: "Heading3", text: "5.18.2 Priority Recommendation" },
  { style: "ListParagraph", text: "Triggered from the 'AI priority review' button on the Projects page toolbar. Opens a modal; clicking 'Run review' calls POST /api/ai/prioritize." },
  { style: "ListParagraph", text: "Inputs sent to the model: every open project's name, status, phase, priority, application/product, project lead, target/start dates, complexity, time estimate, and the depends_on + external_dependencies graphs. Full project descriptions are truncated to ~600 chars per project to keep the prompt token budget bounded." },
  { style: "ListParagraph", text: "Returns: { ranked: Array<{ project_id, recommended_rank, rationale }>, cohort_notes: string, modelId }. The list is sorted by recommended_rank ascending. Rationales explain why each project landed where it did (dependency block, target-date proximity, strategic value, etc.)." },
  { style: "ListParagraph", text: "Output is advisory only — clicking a row opens that project's quick view; nothing on the project record is auto-updated. Re-running the review is one click." },
  { style: "ListParagraph", text: "Default model: anthropic.claude-3-sonnet-20240229-v1:0 (single-region on-demand). The reasoning load benefits from the stronger model; volume is low (admins run this on-demand)." },

  { style: "Heading3", text: "5.18.3 Idea Overlap" },
  { style: "ListParagraph", text: "Triggered by the 'Run overlap check' button on the Idea Review page. Calls POST /api/ideas/[id]/overlap." },
  { style: "ListParagraph", text: "Inputs: the submitted idea + every existing project (id, name, status, application/product, truncated description) and every non-rejected idea in the queue." },
  { style: "ListParagraph", text: "Returns: a human-readable summary plus a structured overlaps_with array (type, id, label, reason per match). If nothing meaningfully overlaps, returns an empty list and a clear 'no overlap' summary so the reviewer can promote without hedging." },
  { style: "ListParagraph", text: "Cached on the idea record (idea.ai_overlap_analysis) so reopening the detail page doesn't re-run the call. The button is labeled 'Re-run check' once a prior analysis is cached." },
  { style: "ListParagraph", text: "Fallback: when AI_ENABLED is false, the route falls back to a keyword-overlap heuristic so the button still produces a useful result for environments without Bedrock access. The same shape ({ analysis, source: 'ai' | 'heuristic' }) is returned in both cases." },
  { style: "ListParagraph", text: "Default model: same Sonnet model as priority recommendation." },

  { style: "Heading3", text: "5.18.4 Model selection (Admin → Configuration → AI)" },
  { style: "ListParagraph", text: "An admin can pick which Bedrock model each of the three features uses, from the live Bedrock model list. The picker calls GET /api/admin/ai/models which merges ListFoundationModels (single-region on-demand) and ListInferenceProfiles (cross-region us-/eu-/apac-/global routing) into one list, tagged with a routing scope so the admin can distinguish a us-regional profile from a global one — they look identical by name otherwise." },
  { style: "ListParagraph", text: "Each saved selection is echoed under its dropdown in monospace so DB-vs-UI drift is always visible. Saving writes to settings.ai_config via PUT /api/admin/ai-config; an audit log entry summarizes per-feature changes." },
  { style: "ListParagraph", text: "Permission: admin.ai.manage." },

  { style: "Heading3", text: "5.18.5 Credentials and region constraints" },
  { style: "ListParagraph", text: "Bedrock is reached via the AWS SDK v3 default Node provider chain. For local dev with IAM Identity Center, AWS_PROFILE points at an SSO profile in ~/.aws/config and the SDK refreshes credentials from the SSO cache as long as the SSO session is valid (a daily `aws sso login --profile <name>` per workday)." },
  { style: "ListParagraph", text: "BEDROCK_REGION sets the service-call region. The SSO region inside the profile is independent — it is consulted only during credential refresh, not for the service call itself." },
  { style: "ListParagraph", text: "Org-level region whitelist policies can block invocation of cross-region inference profiles whenever Bedrock routes the call to a non-whitelisted region. Single-region on-demand model IDs are the only invocation path guaranteed to work under a tight whitelist; the picker's routing-scope tag is the team's signal for which selections are safe." },
  { style: "ListParagraph", text: "Production: AI_ENABLED is unset on Vercel; the assertAiEnabled() gate at every entry point short-circuits with a 503 if the routes are ever called there. Production credential strategy is open — see Section 10." },

  { style: "Heading2", text: "5.19 Idea Submission Portal (/submit)" },
  { style: "ListParagraph", text: "Publicly accessible — no authentication required. Allow-listed in middleware." },
  { style: "ListParagraph", text: "Fields: Submitter Name, Email (optional), Idea Name, Description, Urgency, Requested Target Date, Key Stakeholders." },
  { style: "ListParagraph", text: "Submissions hit POST /api/public/ideas, which is rate-limited per IP." },
  { style: "ListParagraph", text: "On success the submitter sees an inline confirmation; ideas land in the admin Ideas queue with status New." },

  { style: "Heading2", text: "5.20 Ideas Review (Admin/Lead — /admin/ideas, /admin/ideas/[id])" },
  { style: "ListParagraph", text: "List view with status filter and table of submissions; per-idea detail page shows every submitted field plus admin_comments." },
  { style: "ListParagraph", text: "Approve / Reject workflow updates status and writes to admin_comments." },
  { style: "ListParagraph", text: "Convert to Project (conversion-form.tsx) opens a pre-filled new-project form based on idea data. On save it marks the idea Converted and stores converted_to_project_id." },
  { style: "ListParagraph", text: "AI Overlap Check button is stubbed; will call POST /api/ideas/[id]/overlap once the AI provider is wired." },

  { style: "Heading2", text: "5.21 Admin Console (/admin/*)" },
  { style: "Normal", text: "Top-level configuration workspace at /admin/configuration; individual focused admin pages are linked below. Every admin page is gated by the matching permission key from settings.role_permissions, enforced by requirePermission() in each API route and the corresponding page's server load." },
  { style: "ListParagraph", text: "Users & Resources (/admin/users, /admin/resources): invite users (Supabase Auth generates the invite link; email is sent by Supabase), change name and role, deactivate, reset password, view last sign-in. The Users page joins public.users with auth.admin.listUsers() so the 'Invited' badge correctly drops off once the user signs in for the first time." },
  { style: "ListParagraph", text: "Custom Fields (/admin/custom-fields): add/edit text, number, date, boolean, or select fields. Definitions are stored in settings.custom_field_definitions and surface on the project form and project quick-view." },
  { style: "ListParagraph", text: "Task Templates (/admin/templates): create, edit, delete templates; associate with a project_type for automatic offering during project creation." },
  { style: "ListParagraph", text: "Health thresholds (/admin/health-thresholds): edit the Red/Yellow/Green cutoffs and the proximity/inactivity windows. Recalculate-all button reruns every project's score." },
  { style: "ListParagraph", text: "Notifications (/admin/notifications): org-wide notification defaults applied to new users; per-type delivery channel and digest opt-in." },
  { style: "ListParagraph", text: "Role permissions (/admin/role-permissions): grant/revoke individual permission keys per role. Admin is always all-permissions and not editable." },
  { style: "ListParagraph", text: "Resource thresholds (/admin/resource-thresholds): tune the workload-score weights and bucket cutoffs, the on-time/blocked-rate weights and Red/Yellow/Green cutoffs for performance, the default per-assignment allocation percent, and the performance look-back window." },
  { style: "ListParagraph", text: "Portfolio quadrants (/admin/portfolio-quadrants): customize the user-facing labels for the four strategic-position buckets (Quick Win / Major Bet / Fill-In / Deprioritize)." },
  { style: "ListParagraph", text: "Project values (/admin/project-values): admin-extend each of the four extensible project enums (status, phase, priority, application_product) without a code change. Each extension carries a stable id, a display label, an archive flag (hide from new dropdowns, preserve on existing records), and a small enum-specific metadata bag (is_open / is_terminal for statuses, rank for priorities, order for phases, etc.)." },
  { style: "ListParagraph", text: "AI (Configuration → AI tab): per-feature Bedrock model selection (Section 5.18.4). Picker lists every model the AWS account can invoke, tagged with routing scope so the admin can tell single-region from cross-region. Permission: admin.ai.manage." },
  { style: "ListParagraph", text: "Audit Log (/admin/audit-log): paginated, filterable view of every system event (Section 5.22)." },
  { style: "ListParagraph", text: "Branding for PPTX exports: logo, primary color, secondary color, font; lives in settings.branding (no separate page today — edited via the configuration workspace)." },

  { style: "Heading2", text: "5.22 Audit Log" },
  { style: "Normal", text: "Append-only ledger of every create/update/delete/state-change across Projects, Tasks, Ideas, Users, Decisions, Templates, and Settings. Entries are written by lib/audit/service.ts from inside the various entity services; nothing in the application updates or deletes audit rows." },
  { style: "ListParagraph", text: "Fields per row (AuditLogEntry): entry_id, occurred_at, actor_id (nullable for system-driven changes), actor_name (denormalized at write time so renames or deactivations don't break history), entity_type, entity_id, entity_label (human-readable), action (create | update | delete | status_change | convert | invite | deactivate | activate | role_change | password_reset), summary (short human-readable diff like 'Status: In Progress → Blocked')." },
  { style: "ListParagraph", text: "Filter chips on the page are derived from the action and entity_type sets; adding a new action automatically adds a new chip." },
  { style: "ListParagraph", text: "Indexed by occurred_at desc, by (entity_type, entity_id) for per-entity history lookups, by actor_id, and by action." },

  { style: "Heading2", text: "5.23 Global Search" },
  { style: "ListParagraph", text: "GET /api/search hits projects, tasks, ideas, decisions, and document_link labels. Returns a combined ranked list keyed by entity type so the UI can route each hit to the correct page." },
  { style: "ListParagraph", text: "The search box lives in the top bar of the authenticated chrome; results render as a dropdown panel under the input." },

  { style: "Heading2", text: "5.24 Loading, Empty, and Error States" },
  { style: "ListParagraph", text: "Every table page (Projects, Tasks, My Tasks, Ideas, Audit Log, Resources) renders a skeleton on first load." },
  { style: "ListParagraph", text: "Empty states explain why the table is empty (no projects yet, all filtered out, etc.) and offer the next action when one is available (e.g. New Project)." },
  { style: "ListParagraph", text: "API failure surfaces as an inline error banner with a Retry action; the underlying error is logged in the network response for diagnosis without leaking implementation detail to the user." },

  { style: "Heading2", text: "5.25 Accessibility" },
  { style: "ListParagraph", text: "Every interactive element gets a visible focus ring (2px Lyra-blue outline with 2px offset on buttons, links, [role=button], [role=option], [role=tab]); no element is keyboard-trap." },
  { style: "ListParagraph", text: "Tables use semantic <th>/<td> markup; column headers use ARIA labels." },
  { style: "ListParagraph", text: "Modal dialogs trap focus and restore it to the trigger on close; ESC closes." },
  { style: "ListParagraph", text: "Color is never the only signal — Health badges, severity chips, and status indicators carry both color and label." },

  // -------------------------------------------------------------- 6
  { style: "Heading1", text: "6. Authentication & Authorization" },
  { style: "Heading2", text: "6.1 Identity (Supabase Auth)" },
  { style: "ListParagraph", text: "Email/password sign-in via Supabase Auth. Passwords are stored and hashed by Supabase; Praxis never sees a plaintext password." },
  { style: "ListParagraph", text: "Invite flow: an Admin inviting a user calls supabase.auth.admin.generateLink with type='invite', and Praxis constructs the email-link URL by hand using hashed_token + type=invite as query params on /api/auth/callback. This avoids the implicit-flow URL fragment that link prefetchers (corporate Safe Links) used to consume." },
  { style: "ListParagraph", text: "Recovery (forgot-password) and password-reset flows use the same hashed_token URL construction." },
  { style: "ListParagraph", text: "GET /api/auth/callback responds with an HTML interstitial that auto-submits a POST to itself, which calls supabase.auth.verifyOtp. The GET → POST handoff defeats link prefetchers, since they only follow GETs and never submit the form." },

  { style: "Heading2", text: "6.2 Session Management" },
  { style: "ListParagraph", text: "Sessions are cookie-based and refreshed by middleware on every request (Supabase access tokens are short-lived; middleware calls supabase.auth.getUser() so the refresh-token round-trip happens at the edge)." },
  { style: "ListParagraph", text: "Browser uses createBrowserClient from @supabase/ssr so cookies and session state stay in sync with the server. The legacy localStorage-based client was retired to fix a 'Auth session missing' error during password reset." },

  { style: "Heading2", text: "6.3 Authorization" },
  { style: "ListParagraph", text: "Middleware enforces only 'signed in or not'; public routes (/login, /forgot-password, /reset-password, /invite/*, /submit, /api/public/*, /api/auth/callback) are allow-listed. /api/admin/notifications/sweep is self-auth (Bearer CRON_SECRET) and also allow-listed in the middleware so it can run its own check." },
  { style: "ListParagraph", text: "Fine-grained permissions are enforced in each API route via requirePermission() from lib/auth/permissions, which reads settings.role_permissions and the signed-in user's role. The catalog of permission keys lives in lib/auth/role-permissions; unknown keys are dropped on read so a corrupted settings record cannot grant phantom access." },
  { style: "ListParagraph", text: "Server components that need the current user call into lib/auth helpers backed by the request-scoped Supabase client." },

  { style: "Heading2", text: "6.4 Audit" },
  { style: "ListParagraph", text: "All create/update/delete/role-change/password-reset actions are recorded by the audit service. The Audit Log page surfaces these for Admin review (Section 5.22)." },

  // -------------------------------------------------------------- 7
  { style: "Heading1", text: "7. Design Language (Lyra)" },
  { style: "Normal", text: "Praxis follows the Lyra design language as documented in SKILL.lyra 1.md, layered on the pre-existing Polaris CSS primitives. Implemented refinements as of v2:" },
  { style: "ListParagraph", text: "Canvas: neutral gray page background (#e4e5e7) with white cards on top; 12px radius globally; cards lift with a soft 1-3px ambient shadow rather than the older hairline-only treatment." },
  { style: "ListParagraph", text: "Tokens added: --pol-radius-pill (999px) for severity chips, --pol-shadow-card and --pol-shadow-popover for surface elevation." },
  { style: "ListParagraph", text: "Chips: severity tags render as full pills (Open/In Progress/Resolved, blocked/delayed/etc.)." },
  { style: "ListParagraph", text: "Tables: column header bottom rule thinned to a single hairline." },
  { style: "ListParagraph", text: "Focus ring: 2px Lyra-blue outline with 2px offset on every interactive primitive." },
  { style: "ListParagraph", text: "KPI active state: the active stat tile on the home page gets a blue outline in addition to its blue value, per the Lyra 'stat tile' pattern." },
  { style: "Normal", text: "Deferred Lyra patterns (decided in design review, not yet built): dark-mode token swap, AI sparkle icon in the top-right of the main card (will land with AI), workspace switcher (single-tenant — switcher would be noise), split-panel hero on /login (current centered form retained for now)." },

  // -------------------------------------------------------------- 8
  { style: "Heading1", text: "8. Future Integration: GitHub Projects & Jira" },
  { style: "Normal", text: "Architectural scaffolding from v1 is intact and unchanged. No integration code has been built yet." },
  { style: "ListParagraph", text: "github_issue_id and jira_issue_id columns exist on projects and tasks." },
  { style: "ListParagraph", text: "All create/update flows route through service modules, so adding a sync call is one location-change per entity rather than a hunt-and-replace across API routes." },
  { style: "ListParagraph", text: "/api/webhooks/github and /api/webhooks/jira are not yet implemented but can be added as new App Router routes; the middleware allow-list will need them added." },
  { style: "ListParagraph", text: "Field-mapping configuration UI is not built; when work resumes, this lives in the Admin console alongside other settings." },

  // -------------------------------------------------------------- 9
  { style: "Heading1", text: "9. Implementation History (Phases Shipped)" },
  { style: "Normal", text: "Praxis was built and migrated in discrete phases. This section is descriptive — useful for onboarding and historical context — rather than prescriptive." },

  { style: "Heading2", text: "Phase 1 (April 2026): JSON-File MVP" },
  { style: "ListParagraph", text: "Full app scaffolded as the IIM (Innovation Initiative Management) project on Next.js 15 with TypeScript, Tailwind, and a JSON file store." },
  { style: "ListParagraph", text: "Entity types, repositories, services, and all UI for Projects, Tasks, Ideas, Roadmap views, Velocity dashboard, Decision Log, Document Links, Health scoring, Notifications (in-app), Templates, Audit Log, Resources (Insights), and Admin console (custom fields, health thresholds, role permissions, resource thresholds, portfolio quadrants, project values, notifications defaults, branding)." },
  { style: "ListParagraph", text: "PPTX export shipped." },
  { style: "ListParagraph", text: "Seed script reads the New Project Ideas tab from the source spreadsheet, skipping rows with status Approved (already promoted)." },

  { style: "Heading2", text: "Phase 2 (May 2026): Application rename and Lyra refinements (current document)" },
  { style: "ListParagraph", text: "All UI references renamed from IIM / Innovation Initiative Management to Praxis. Repository folder names were intentionally left alone (still iim-app) to keep the import graph stable; only user-visible strings changed." },
  { style: "ListParagraph", text: "High-severity Next.js vulnerability patched via npm." },
  { style: "ListParagraph", text: "Audit log 'Unknown User' actor regression fixed (default Admin now resolves correctly)." },

  { style: "Heading2", text: "Phase 3 (May 2026): Supabase + Vercel Migration" },
  { style: "ListParagraph", text: "Stage 0: Scaffolding — added @supabase/supabase-js, @supabase/ssr; introduced lib/supabase/{server,request,client}.ts; wired NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
  { style: "ListParagraph", text: "Stage 1: Database — applied 0001_initial_schema.sql; ran scripts/migrate-to-supabase.ts to import every JSON file into Postgres preserving IDs (including legacy UUIDs); ran scripts/smoke-supabase.ts to validate read paths against the live database." },
  { style: "ListParagraph", text: "Stage 2: Auth — replaced NextAuth credential provider with Supabase Auth; built /login, /forgot-password, /reset-password and /api/auth/callback (HTML interstitial pattern); migrated existing users into auth.users via scripts/migrate-users-to-auth.ts preserving user_id; built scripts/issue-recovery-link.ts and scripts/update-admin-email.ts for admin recovery without UI; built scripts/bulk-create-users.ts to bypass Supabase's 2-emails-per-hour free-tier limit for initial team onboarding." },
  { style: "ListParagraph", text: "Stage 3: Scheduler — added vercel.json with the 07:00 UTC daily cron; wired /api/admin/notifications/sweep with CRON_SECRET Bearer auth and middleware allow-list." },
  { style: "ListParagraph", text: "Stage 4: Deploy + Cleanup — production deployed on Vercel; migration 0002 dropped the now-dead password_hash / invite_token / reset_token columns from public.users; pages that read session at SSR time were marked export const dynamic = 'force-dynamic' so they aren't pre-rendered at build time without env vars." },

  { style: "Heading2", text: "Phase 4 (May 2026): Post-Migration Refinements" },
  { style: "ListParagraph", text: "Users-page status fix: 'Invited' badge stopped persisting after sign-in by joining public.users with auth.admin.listUsers() at SSR time so last_sign_in_at is resolved server-side." },
  { style: "ListParagraph", text: "Auto-unblock cascade implemented in lib/tasks/service.ts (Section 5.10.1)." },
  { style: "ListParagraph", text: "External Dependencies feature added (migration 0003, validator, editor panel in quick-view). Section 5.11." },
  { style: "ListParagraph", text: "Lyra light-mode design refinements applied (Section 7)." },

  { style: "Heading2", text: "Phase 5 (May 2026): AI Advisor (local-dev)" },
  { style: "ListParagraph", text: "Three AI features wired to AWS Bedrock: complexity estimate (Haiku), priority recommendation (Sonnet), idea overlap (Sonnet)." },
  { style: "ListParagraph", text: "Bedrock authentication uses IAM Identity Center via the AWS SDK's default Node provider chain, with AWS_PROFILE pointing at an SSO profile in ~/.aws/config. Credentials auto-refresh from the SSO cache for the duration of the SSO session." },
  { style: "ListParagraph", text: "Three new server modules (lib/ai/estimate.ts, prioritize.ts, overlap.ts) and one shared Converse runner (lib/ai/converse.ts) that handles the Bedrock response shape, strips markdown fences when models leak them, and parses JSON output." },
  { style: "ListParagraph", text: "Discovery script (scripts/ai-list-models.ts, npm run ai:list-models) prints the merged list of foundation models + inference profiles the account can reach." },
  { style: "ListParagraph", text: "Admin → Configuration → AI tab lets an admin pick the model per feature from the live list. Routing scope tag distinguishes single-region on-demand from us-regional / global inference profiles, which matters under tight org region-whitelist policies." },
  { style: "ListParagraph", text: "Migration 0004 adds settings.ai_config; the AppSettings type and SettingsRepository.get() merge logic were extended to match. New admin.ai.manage permission key." },
  { style: "ListParagraph", text: "Features are gated by AI_ENABLED and intentionally OFF in production until a Vercel-compatible credential strategy is decided. The overlap feature falls back to a keyword heuristic when AI is off so the button always returns something useful." },

  // -------------------------------------------------------------- 10
  { style: "Heading1", text: "10. Risks & Mitigations" },
  { style: "ListParagraph", text: "Email delivery rate limits: Supabase free tier caps invite/recovery emails at 2/hour. Mitigation: scripts/bulk-create-users.ts bypasses this for initial onboarding by creating Auth users without sending a verification email; an Admin can then issue a recovery link individually as needed." },
  { style: "ListParagraph", text: "Link prefetchers (corporate Safe Links, anti-phishing scanners) consuming single-use OTP tokens. Mitigation: /api/auth/callback responds with an HTML interstitial on GET that POSTs back the actual verifyOtp call; prefetchers only GET, so the token survives until the human clicks." },
  { style: "ListParagraph", text: "Implicit-flow URL fragments stripped by corporate email clients leading to 'missing_code' errors on first click. Mitigation: switched away from generateLink's default action_link to manually-constructed URLs that use hashed_token + type as query params, which survive Outlook/Defender rewriting." },
  { style: "ListParagraph", text: "Service-role key exposure. Mitigation: SUPABASE_SERVICE_ROLE_KEY is server-only, never sent to the client; .env.example contains placeholders only; the team's process is to rotate the key if it is ever pasted into a file that gets committed." },
  { style: "ListParagraph", text: "Vercel Hobby plan 10-second function timeout. Mitigation: long-running operations (recompute-all health, bulk imports) are run via tsx scripts against the database directly, not via web routes." },
  { style: "ListParagraph", text: "Single-tenant assumption baked into role enforcement. Mitigation: documented in Section 2; multi-tenant support is out of scope and would be a major design change requiring an org/workspace concept across every entity." },
  { style: "ListParagraph", text: "AI features unavailable in production. Bedrock authentication uses IAM Identity Center, which requires an interactive `aws sso login` to refresh — Vercel cannot do this. Mitigation today: AI_ENABLED is unset on Vercel; the assertAiEnabled() gate short-circuits production calls with a 503. Open question: production credential strategy. Realistic options are (a) provision a dedicated AWS sandbox account with a long-lived IAM user just for Bedrock, (b) stand up a credential-vending service (Lambda elsewhere we can create) and push refreshed creds to Vercel's env-var API on a schedule, (c) switch the integration to call the Anthropic API directly, sidestepping Bedrock and the AWS-side credential problem." },
  { style: "ListParagraph", text: "Org region-whitelist deny policies can block Bedrock inference profiles that route across regions. Mitigation: the admin AI picker tags each model with its routing scope (single-region on-demand vs us-/eu-/apac-/global inference profile) so the admin can pick a model whose routing stays inside the allowed region set. In tightly-restricted environments (e.g. us-east-1 only), only bare on-demand model IDs are reliable, which limits model selection to older Claude 3 (or whatever the account has on-demand access to). Expanding the whitelist or switching to the Anthropic API are the only paths to newer models." },

  // -------------------------------------------------------------- 11
  { style: "Heading1", text: "11. Operational Scripts" },
  { style: "Normal", text: "Maintenance and migration scripts live under scripts/ and are invoked via npm run … or directly with tsx. The set as of v2:" },
  { style: "ListParagraph", text: "npm run seed — initial seed of projects/tasks/ideas from the source spreadsheet (skips already-Approved ideas)." },
  { style: "ListParagraph", text: "npm run import:spreadsheet — re-import ideas from the New Project Ideas tab; idempotent against existing IDs." },
  { style: "ListParagraph", text: "npm run migrate:supabase — one-time JSON → Postgres migration (Phase 3 Stage 1). Now historical." },
  { style: "ListParagraph", text: "npm run migrate:auth-users — one-time NextAuth users → auth.users migration preserving user_id (Phase 3 Stage 2). Now historical." },
  { style: "ListParagraph", text: "npm run admin:update-email — change a user's email address (both auth.users and public.users)." },
  { style: "ListParagraph", text: "npm run admin:recovery-link — issue a recovery link for a user (admin reset)." },
  { style: "ListParagraph", text: "npm run admin:delete-user — testing-only deletion that removes both the public profile and the auth user." },
  { style: "ListParagraph", text: "npm run admin:bulk-create — bulk-create initial team users without triggering individual invite emails." },
  { style: "ListParagraph", text: "npm run smoke:* — per-feature smoke tests (db, projects, tasks, roadmap, export, decisions, notifications, health, velocity, admin-exclusion, ideas, template, supabase)." },
  { style: "ListParagraph", text: "tsx scripts/run-notifications-sweep.ts — run the daily sweep manually (useful in development since the Vercel Cron only runs in production)." },
  { style: "ListParagraph", text: "npm run ai:list-models — list every Bedrock model the account can invoke from the configured region (merges on-demand foundation models with cross-region inference profiles, tagged by routing scope). Useful to confirm what's available before choosing model defaults in Admin → AI." },
  { style: "ListParagraph", text: "npm run prepare:branding — packages branding assets for PPTX export." },

  // -------------------------------------------------------------- 12
  { style: "Heading1", text: "Appendix A: Database Schema Reference" },
  { style: "Normal", text: "Authoritative schema lives in supabase/migrations/. As of v2.1 there are four migrations:" },
  { style: "ListParagraph", text: "0001_initial_schema.sql — every table (users, projects, tasks, ideas, decisions, notifications, templates, audit_log, settings), the next_project_id() / next_task_id() id-generator functions, the set_updated_at() trigger, indexes, and the per-table RLS enable (no policies — service role bypasses)." },
  { style: "ListParagraph", text: "0002_drop_legacy_auth_columns.sql — drops password_hash, invite_token, invite_token_expires_at, password_reset_token, password_reset_token_expires_at from public.users now that identity is owned by Supabase Auth." },
  { style: "ListParagraph", text: "0003_external_dependencies.sql — adds the external_dependencies jsonb column to projects." },
  { style: "ListParagraph", text: "0004_ai_config.sql — adds the ai_config jsonb column to settings, with default per-feature Bedrock model assignments (Section 5.18). Defensive merge in SettingsRepository.get() handles rows missing the column on read." },
  { style: "Normal", text: "Every column's TypeScript shape is documented in lib/db/types.ts; the SQL column types are chosen to round-trip cleanly with PostgREST (text[] for primitive arrays, jsonb for arrays of objects, date for IsoDate, timestamptz for IsoTimestamp)." },

  { style: "Heading1", text: "Appendix B: Route Inventory" },
  { style: "Heading2", text: "Pages" },
  { style: "ListParagraph", text: "/ — authenticated home (KPI tiles, recent activity, Next Up — AI stub)." },
  { style: "ListParagraph", text: "/login, /forgot-password, /reset-password — auth pages." },
  { style: "ListParagraph", text: "/projects — Projects table (Section 5.1)." },
  { style: "ListParagraph", text: "/tasks — Tasks table (Section 5.2)." },
  { style: "ListParagraph", text: "/my-tasks — current user's tasks (Section 5.3)." },
  { style: "ListParagraph", text: "/roadmap — Timeline / Kanban / Bubble / Now-Next-Later / Capacity (Sections 5.4-5.8)." },
  { style: "ListParagraph", text: "/dashboard/velocity — Velocity & Throughput (Section 5.16)." },
  { style: "ListParagraph", text: "/insights/resources, /insights/resources/[user_id] — Resource analytics (Section 5.17)." },
  { style: "ListParagraph", text: "/profile/notifications — per-user notification preferences." },
  { style: "ListParagraph", text: "/submit — public idea submission portal (Section 5.19)." },
  { style: "ListParagraph", text: "/admin/configuration — configuration workspace, plus the dedicated pages listed in Section 5.21." },
  { style: "ListParagraph", text: "/403 — forbidden landing for permission failures." },

  { style: "Heading2", text: "API Routes" },
  { style: "ListParagraph", text: "/api/auth/callback (Supabase OTP/recovery handshake, HTML interstitial)." },
  { style: "ListParagraph", text: "/api/projects, /api/projects/[id], /api/projects/[id]/apply-template, /api/projects/[id]/decisions, /api/projects/export, /api/projects/recalculate-health." },
  { style: "ListParagraph", text: "/api/tasks, /api/tasks/[id]." },
  { style: "ListParagraph", text: "/api/ideas, /api/ideas/[id], /api/ideas/[id]/convert, /api/ideas/[id]/overlap (AI overlap analysis — dispatches to Bedrock when AI is enabled, keyword heuristic otherwise)." },
  { style: "ListParagraph", text: "/api/ai/estimate, /api/ai/prioritize — AI Advisor endpoints (Section 5.18). Gated by AI_ENABLED; 503 in production." },
  { style: "ListParagraph", text: "/api/public/ideas (rate-limited public submission)." },
  { style: "ListParagraph", text: "/api/notifications, /api/notifications/[id]/read, /api/profile/notifications." },
  { style: "ListParagraph", text: "/api/templates, /api/templates/[id]." },
  { style: "ListParagraph", text: "/api/dashboard/velocity." },
  { style: "ListParagraph", text: "/api/roadmap/kanban-configs." },
  { style: "ListParagraph", text: "/api/search." },
  { style: "ListParagraph", text: "/api/export/pptx." },
  { style: "ListParagraph", text: "/api/admin/audit-log, /api/admin/custom-fields, /api/admin/health-thresholds, /api/admin/health-thresholds/recalculate, /api/admin/portfolio-quadrants, /api/admin/project-values, /api/admin/resource-thresholds, /api/admin/role-permissions, /api/admin/users, /api/admin/users/[id], /api/admin/users/[id]/reset-password." },
  { style: "ListParagraph", text: "/api/admin/ai-config (PUT — write per-feature model selection), /api/admin/ai/models (GET — live Bedrock model list)." },
  { style: "ListParagraph", text: "/api/admin/notifications/sweep (Vercel Cron target, Bearer-authenticated)." },

  { style: "Heading1", text: "Appendix C: Phase & Status Reference" },
  { style: "Heading2", text: "Project Status (built-in)" },
  { style: "Normal", text: "Not Started, In Planning, In Progress, Blocked, On Hold, Delayed, Completed, Canceled. Admin-extensible via Admin → Project values; each admin-added value carries is_open and is_terminal flags so the default Projects filter and 'completed' detection work without code changes." },
  { style: "Heading2", text: "Project Phase (built-in)" },
  { style: "Normal", text: "Qualification, Prioritization, Planning, Data Modeling, Application Development, Customer Validation, Deployment Readiness, Handover, Closeout. Admin-extensible; order is preserved by the order metadata field." },
  { style: "Heading2", text: "Priority (built-in)" },
  { style: "Normal", text: "Critical, High, Medium, Low. Admin-extensible; each admin-added priority carries a rank to sort it into the existing ordering." },
  { style: "Heading2", text: "Task Status" },
  { style: "Normal", text: "Not Started, In Progress, Blocked, Delayed, On Hold, Complete, Canceled. Task statuses are NOT admin-extensible — they're load-bearing for the auto-unblock cascade and the health-score computation." },

  { style: "Normal", text: "" },
  { style: "Normal", text: "— End of Document —" },
];

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraphXml(p: Para): string {
  const text = escapeXml(p.text);
  const pPr =
    p.style === "Normal"
      ? ""
      : `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>`;
  const run = p.text === ""
    ? ""
    : `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  return `<w:p>${pPr}${run}</w:p>`;
}

function buildDocumentXml(body: Para[]): string {
  const paras = body.map(paragraphXml).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paras}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

// ---------------------------------------------------------------------------
// Main: load v1 as a template, swap document.xml, write v2.
// ---------------------------------------------------------------------------

async function main() {
  const root = resolve(__dirname, "..");
  const v1Path = join(root, "IIM_Application_Design_Requirements.docx");
  const v2Path = join(root, "Praxis_Application_Design_Requirements_v2.docx");

  const v1Buf = readFileSync(v1Path);
  const zip = await JSZip.loadAsync(v1Buf);

  // Replace word/document.xml with the v2 body. Everything else
  // (styles.xml, fontTable.xml, etc.) is reused from v1 so the
  // rendered styles look identical.
  zip.file("word/document.xml", buildDocumentXml(paragraphs));

  // Update the title in docProps/core.xml if present, so Word's
  // properties panel shows the new title. Best-effort — we leave the
  // file alone if its shape is unexpected.
  const coreFile = zip.file("docProps/core.xml");
  if (coreFile) {
    const coreXml = await coreFile.async("string");
    const updated = coreXml.replace(
      /<dc:title>[^<]*<\/dc:title>/,
      `<dc:title>Praxis - Design Document &amp; Implementation Requirements v2</dc:title>`,
    );
    zip.file("docProps/core.xml", updated);
  }

  const out = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(v2Path, out);

  console.log(`Wrote ${v2Path} (${out.length} bytes, ${paragraphs.length} paragraphs).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
