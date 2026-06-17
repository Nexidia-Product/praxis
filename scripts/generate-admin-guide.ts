/**
 * Generates `Praxis_Administrator_Guide.docx` at the project root.
 *
 * Reuses the same mechanism as scripts/generate-design-doc-v2.ts: it
 * loads an existing .docx as a template (to inherit its styles.xml /
 * fontTable.xml / numbering.xml) and replaces the `word/document.xml`
 * body with the admin-guide content below.
 *
 * Run with:
 *   npx tsx scripts/generate-admin-guide.ts
 *
 * The `paragraphs` array is the source of truth for the document body.
 * Styles map to the names the template defines (Title, Subtitle,
 * Heading1, Heading2, Heading3, Normal, ListParagraph). Edit the array
 * to revise the guide, then re-run.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

// Small helpers so the content array stays readable.
const h1 = (text: string): Para => ({ style: "Heading1", text });
const h2 = (text: string): Para => ({ style: "Heading2", text });
const h3 = (text: string): Para => ({ style: "Heading3", text });
const p = (text: string): Para => ({ style: "Normal", text });
const li = (text: string): Para => ({ style: "ListParagraph", text });
const gap = (): Para => ({ style: "Normal", text: "" });

// ---------------------------------------------------------------------------
// Document body — Praxis Administrator Guide.
// ---------------------------------------------------------------------------

const paragraphs: Para[] = [
  gap(),
  gap(),
  { style: "Title", text: "Praxis" },
  { style: "Subtitle", text: "Administrator Guide" },
  gap(),
  p("Version 1.0  |  June 2026"),
  gap(),
  p("This guide is written for administrators of Praxis — the people who set up the application, manage users and access, tune how the system scores and reports on work, and keep it running day to day. It explains what every part of the application does and how an administrator controls it. No prior familiarity with the codebase is assumed."),
  gap(),

  // ===================================================================
  h1("1. Introduction"),
  h2("1.1 What Praxis Is"),
  p("Praxis is a purpose-built web application for tracking, managing, and prioritizing innovation projects, tasks, and submitted ideas within a single team. It replaces a spreadsheet-based workflow with a structured system that is fast to use day to day and provides multiple roadmap views, role-based access control, a public idea-submission portal, an audit trail, project and resource health analytics, a velocity dashboard, PowerPoint export, and optional AI assistance."),
  p("The application is single-tenant: it serves one organization/team. There is no concept of separate workspaces or tenants, and that assumption is intentional throughout."),

  h2("1.2 Who This Guide Is For"),
  p("You should read this guide if you hold the Admin role, or if a non-Admin role has been granted one or more administrative permissions. Most of the configuration described here lives behind the Admin section of the application and is gated by permissions covered in Section 3."),

  h2("1.3 How the Application Is Built (At a Glance)"),
  p("You do not need to operate the codebase to administer Praxis, but a few facts about its architecture explain how the pieces fit together:"),
  li("Front end and server: a Next.js application (App Router). Pages render server-side and call internal service modules for all reads and writes."),
  li("Database and identity: Supabase (PostgreSQL) stores all application data; Supabase Auth owns user identity (email/password). The application profile — name, role, active flag, preferences — lives in a users table joined to the auth identity."),
  li("Hosting: deployed on Vercel. A daily Vercel Cron job drives the notification sweep (Section 9)."),
  li("AI: the optional AI features call AWS Bedrock. They are controlled by an environment flag and per-feature model selection (Section 11)."),
  li("Email: transactional email (invites, recovery, notifications) is sent through Resend when configured; otherwise email content is logged for development."),

  h2("1.4 How This Guide Is Organized"),
  li("Sections 2–4 cover access and security: authentication, roles and permissions, and user management — the first things to set up."),
  li("Sections 5–7 cover the core records you manage: projects, tasks, and ideas."),
  li("Sections 8–13 cover the views, dashboards, and system features built on top of those records: the roadmap, velocity, resources, key capabilities, health scoring, notifications, search, templates, and export."),
  li("Section 14 is the Administration Console reference — every configuration surface in one place."),
  li("Sections 15–17 cover the audit log, deployment and environment, and operational scripts."),
  li("The appendices provide quick-reference tables: the full permission catalog, the status/phase/priority reference, and a route inventory."),

  // ===================================================================
  h1("2. Authentication & Access"),
  h2("2.1 Identity Model"),
  p("Identity is owned by Supabase Auth. Users sign in with an email address and password; Praxis never stores or sees a plaintext password — Supabase hashes and stores it. Each signed-in identity is matched to an application profile record that carries the user's display name, role, active flag, and notification preferences."),
  p("Deactivated accounts (active = false) are treated as not signed in: the session resolver returns nothing for them, so a deactivated user is locked out on their next request without their history being deleted."),

  h2("2.2 Sessions"),
  li("Sessions are cookie-based. Middleware refreshes the session on every request so short-lived access tokens are renewed transparently."),
  li("Signing out clears the session cookies. There is no separate idle-timeout setting in the application; session lifetime follows Supabase Auth's token settings."),

  h2("2.3 Sign-In, Invite, and Password Recovery"),
  li("Sign-in: users go to /login and enter email and password. Already-signed-in users are redirected to the home page."),
  li("Invite: when an Admin invites a user (Section 4), Supabase issues an invitation link. The new user follows it, is taken to the set-password page, and chooses a password — which both activates the account and signs them in."),
  li("Forgot password: any user can request a recovery link from /forgot-password. The confirmation message is deliberately generic (it does not reveal whether the email exists) to avoid leaking which addresses have accounts."),
  li("Reset password: the recovery link lands on /reset-password, where the user sets a new password."),

  h2("2.4 Why Email Links Use an Interstitial Page"),
  p("Invite and recovery links carry a single-use token. Corporate email security (link prefetchers such as Microsoft Defender Safe Links, and chat unfurlers) often fetch a link before the human clicks it. If the link were a plain GET that consumed the token, the prefetcher would burn it and the real user would arrive to an 'invalid link' error."),
  p("To prevent that, the authentication callback responds to a GET with a small HTML page that immediately submits a form via POST to complete the verification. Prefetchers follow GETs but do not submit forms, so the token survives until the human actually clicks. This is invisible to users and requires no administrator action, but it explains why clicking a link briefly shows a 'verifying…' page. If you ever customize Supabase's email templates, keep the callback URL format intact (token parameters passed as query parameters to the callback route)."),

  // ===================================================================
  h1("3. Roles & Permissions"),
  h2("3.1 The Four Roles"),
  p("Every user holds exactly one role. Roles are hierarchical in spirit — Admin is the most privileged, Viewer the least — but in practice what a role can do is determined entirely by the permissions mapped to it (Section 3.3), not by the role name."),
  li("Admin — full control. Admin always has every permission in the catalog, and this cannot be edited or removed. There is no way to misconfigure an Admin into being locked out."),
  li("Project Lead — manages projects, tasks, and the idea pipeline, and can export the roadmap and see all resources. By default cannot reach the Admin console."),
  li("Team Member — works on projects and tasks (view/create/edit tasks, view projects) and views the roadmap and velocity dashboard."),
  li("Viewer — read-only access to projects, tasks, the roadmap, and the velocity dashboard."),

  h2("3.2 The Permission Catalog"),
  p("The application defines 29 permissions, grouped into six categories. A permission is the unit of access enforced throughout the app — each protected page and action checks for a specific permission key. The full catalog with descriptions is in Appendix A; the categories are:"),
  li("Projects (4): view, create, edit, delete. Note that deleting a project is distinct from canceling it — cancellation is a status, deletion permanently removes the record."),
  li("Tasks (5): view, create, edit, delete, and move (reassign a task to a different project)."),
  li("Ideas (2): review (work the submission queue) and convert (promote an approved idea into a project)."),
  li("Roadmap (2): view the roadmap, and export it to PowerPoint."),
  li("Insights (4): view the velocity dashboard, manage key capabilities, view Resources (defaults to your team), and view all resources (the full org roster)."),
  li("Administration (12): access the Admin section, plus a separate permission for each admin surface — manage users, manage roles & permissions, manage custom fields, manage task templates, manage health thresholds, manage resource thresholds, manage project values, manage portfolio quadrants, manage AI model selection, run the notifications sweep, and view the audit log."),
  p("Because each admin surface is gated separately, you can delegate a narrow slice of administration — for example, let a Project Lead manage task templates without giving them user management — by granting just that one permission to their role. Granting any admin.* permission is only useful alongside 'Access the Admin section' (admin.console), which reveals the Admin group in the navigation."),

  h2("3.3 Default Role-to-Permission Mapping"),
  p("On first run, each role is seeded with these defaults. You can change them at any time (Section 3.4); Admin is fixed at the full set."),
  li("Project Lead: view/create/edit projects; view/create/edit/delete/move tasks; review and convert ideas; view and export the roadmap; view velocity; view resources and view all resources."),
  li("Team Member: view projects; view/create/edit tasks; view the roadmap; view velocity."),
  li("Viewer: view projects; view tasks; view the roadmap; view velocity."),
  li("None of the non-Admin roles has any Administration permission by default."),

  h2("3.4 Editing Roles & Permissions"),
  p("Open Admin → Resource Management → Roles & Permissions (permission: manage roles & permissions). The editor is a matrix: permissions are rows, grouped by category; roles are columns. Toggle a checkbox to grant or revoke a (role, permission) pair."),
  li("The Admin column is shown but locked — Admin always has everything."),
  li("Changes are local until you click Save; Discard reverts to the last saved state, and Reset to defaults loads the seeded defaults (you still must Save to persist them)."),
  li("There are intentionally no whole-row 'grant to everyone' buttons, to prevent accidental mass changes."),
  li("Caution: if you grant a role an admin.* permission but not 'Access the Admin section', members of that role won't be able to navigate to the page even though the underlying action is permitted. Grant admin.console alongside any other admin permission."),

  h2("3.5 How Access Is Enforced"),
  li("Signed-in vs. not is enforced globally; a small set of public routes (login, forgot/reset password, the invite acceptance flow, the public idea-submission portal and its API, and the auth callback) are allow-listed and need no session."),
  li("Beyond that, every protected page and API action checks for a specific permission. A signed-in user who lacks the permission for a page is redirected to a styled '403 — not authorized' page that shows their current role; API calls return a 403 response."),
  li("Because the role-to-permission mapping is data (not code), you can reshape who can do what without a software change — the exception being the set of permissions itself, which only changes when new gates are added to the application."),

  // ===================================================================
  h1("4. User Management"),
  p("Open Admin → Resource Management → Users (permission: manage users). The page lists every user with their name, email, role, status, and last sign-in, plus per-user actions."),

  h2("4.1 User Statuses"),
  li("Pending invite — the account has been created but the person has never signed in."),
  li("Active — the person has signed in at least once and the account is enabled."),
  li("Inactive — the account has been deactivated by an administrator and cannot sign in."),

  h2("4.2 Inviting a User"),
  li("Use the invite form at the top of the Users page: enter the new user's email and name and submit."),
  li("The application surfaces the invite link on screen. If transactional email is configured (Resend), the invitation is also emailed; if not, you can copy the on-screen link and share it directly."),
  li("New users default to the role you assign; you can change it later. The invited user sets their password via the link, which activates and signs them in."),

  h2("4.3 Changing a Role"),
  li("Use the role dropdown on the user's row (Admin, Project Lead, Team Member, Viewer). The change is recorded in the audit log as a role_change."),
  li("You cannot demote your own account — this guard prevents an administrator from accidentally removing their own access."),

  h2("4.4 Deactivating and Reactivating"),
  li("Use the activate/deactivate toggle on the user's row. Deactivating sets the account inactive; the user is locked out on their next request but their record and history are preserved."),
  li("You cannot deactivate your own account."),

  h2("4.5 Password Resets"),
  li("Use the reset action on the user's row to issue a password-reset link. As with invites, the link is shown on screen and emailed when email is configured."),

  h2("4.6 Command-Line User Tools"),
  p("Some user operations are available as scripts for operators (Section 17), useful for bulk onboarding or recovery when the UI or email isn't an option: bulk-create an initial roster without sending individual emails, mint a recovery link for one user, change an administrator's email address, and (for testing only) fully delete a user. These require database credentials and are run from the server, not the application UI."),

  // ===================================================================
  h1("5. Projects"),
  p("A project is the central record in Praxis. Each project has an auto-assigned identifier in the form YYYY-NNN (year of creation plus a sequence number, e.g. 2026-001)."),

  h2("5.1 Project Fields"),
  li("Identity: name, description, and a definition of done (free-text acceptance criteria / what 'done' looks like)."),
  li("Classification: application/product (e.g. 'Automated Insights'), project type, priority, phase, and status."),
  li("People: a project lead (required) and additional resources (a mix of registered users and free-text names), plus primary stakeholders."),
  li("Resource allocation: a per-resource percentage (0–100) of their time committed to this project, feeding the Resources workload math. Resources without an explicit allocation fall back to the organization default (Section 14)."),
  li("Dates: a target date, and a start date (used by the roadmap timeline, capacity, and velocity views). The start date is auto-set to today the first time a project moves from 'Not Started' into an active status, unless already set."),
  li("Roadmap bucket: a free-text grouping used by the Now/Next/Later board; new projects default to 'Unplaced'."),
  li("Health: a computed Red/Yellow/Green health score with a rolling history (Section 12)."),
  li("AI fields: an AI complexity score and time estimate (Section 11), when AI is enabled."),
  li("Custom fields: any administrator-defined fields (Section 14) appear on every project."),
  li("Links and dependencies: document links, internal project-to-project dependencies, and external dependencies (covered below)."),
  li("Key capability: a flag and an optional committed quarter (Section 10)."),

  h2("5.2 Status, Phase, and Priority"),
  p("Projects carry three lifecycle dimensions, all of which administrators can extend (Section 14):"),
  li("Status (built-in): Not Started, In Planning, In Progress, Blocked, On Hold, Delayed, Completed, Canceled. Administrator-added statuses each carry 'is open' and 'is terminal' flags so default filters and completion detection keep working."),
  li("Phase (built-in): Qualification, Prioritization, Planning, Data Modeling, Application Development, Customer Validation, Deployment Readiness, Handover, Closeout. Administrator-added phases carry an order value to slot them into the sequence."),
  li("Priority (built-in): Critical, High, Medium, Low. Administrator-added priorities carry a rank to position them in the ordering."),

  h2("5.3 Status History and Status Notes"),
  p("Every status change is recorded in an append-only status history on the project, capturing what changed, when, and who made the change. Each change can carry an optional free-text note explaining why (for example, 'Blocked on data-platform throughput'). The most recent note is surfaced on the Key Capabilities cards (Section 10). A note can also be added without changing the status."),

  h2("5.4 Dependencies"),
  li("Internal dependencies link one project to another. Two kinds are supported: 'Blocks Start' (the upstream project must finish before this one starts) and 'Blocks Phase' (the upstream must reach a specified phase). Cycles are detected and rejected."),
  li("External dependencies track work outside Praxis — a vendor deliverable, another team's Jira ticket, a third-party feature. Each has a label, owner, optional link, status (Open / In Progress / Resolved), and optional target date. These are informational and feed the health score's upstream-risk consideration."),

  h2("5.5 Document Links"),
  p("Projects (and tasks) can carry labeled links to related documents — GitHub repos and pull requests, Confluence, SharePoint, network drives, Figma, Miro, Jira issues, and generic external links. Each link records who added it and when."),

  h2("5.6 Templates"),
  p("When creating a project you may apply a task template (Section 13). The template's tasks are created as real tasks on the new project, with their inter-task dependencies preserved. Templates are defined and maintained by administrators."),

  // ===================================================================
  h1("6. Tasks"),
  p("Tasks belong to a project and have their own auto-assigned identifiers. A task is the unit of trackable work."),

  h2("6.1 Task Fields"),
  li("Identity: task name and detailed description."),
  li("Classification: status and priority."),
  li("People: a responsible owner (required) plus additional assignees (registered users or free-text names)."),
  li("Scheduling: a target (due) date and an optional time estimate in hours (decimals allowed)."),
  li("Blocker information: a 'blocked' flag plus optional structured detail — what's blocking it and whether the blocker is another task, a project, or something else."),
  li("Comments: a free-text comment field with an append-only comment history."),
  li("Links and dependencies: document links and task-to-task dependencies."),

  h2("6.2 Task Statuses"),
  p("Task statuses are: Not Started, Awaiting Dependency, In Progress, Blocked, Delayed, On Hold, Complete, Canceled. Unlike project values, task statuses are NOT administrator-extensible — they are load-bearing for the auto-unblock behavior and the health score."),
  li("'Blocked' (the status) and the 'blocked' flag are kept consistent: setting the status to Blocked sets the flag. A task can also be flagged blocked while still 'In Progress'."),
  li("'Awaiting Dependency' is set automatically (see below), not chosen by hand."),

  h2("6.3 Task Dependencies and Auto-Unblock"),
  p("Tasks can depend on other tasks using the standard four relationship types (Finish-to-Start, Start-to-Start, Finish-to-Finish, Start-to-Finish). The application automates the most common case, Finish-to-Start:"),
  li("When a not-started task gains a Finish-to-Start predecessor, its status automatically becomes 'Awaiting Dependency'. Removing the last such predecessor returns it to 'Not Started'."),
  li("When a task is marked Complete, the system checks every downstream task that was awaiting it. If all of that downstream task's Finish-to-Start predecessors are now complete, it is automatically released back to 'Not Started' — no manual unblocking needed. This cascade applies only to Finish-to-Start relationships."),
  li("An explicit status set by a user always wins over the automatic behavior."),

  h2("6.4 Moving a Task Between Projects"),
  p("Users with the 'move tasks' permission (Admin and Project Lead by default) can reassign a task to a different project — useful when work is descoped from one project into another. The destination must be an open project (not Completed or Canceled). Health scores on both the source and destination projects are recalculated, and the move is recorded in the audit log."),

  h2("6.5 My Tasks"),
  p("Each user has a 'My Tasks' view showing tasks they are responsible for or assigned to. It offers a standard table view and a personal checklist view of open tasks that each user can reorder; the order is saved per user."),

  // ===================================================================
  h1("7. Ideas & the Public Submission Portal"),
  p("Ideas are lightweight proposals that can be triaged and promoted into projects. They enter through a public portal and are worked in an internal review queue."),

  h2("7.1 The Public Submission Portal"),
  li("The portal lives at /submit and requires no sign-in — it is meant to be shared widely so anyone can contribute an idea."),
  li("A submission captures the submitter's name (required) and email (optional), the idea name, a description, an urgency, an optional requested target date, key stakeholders, and up to five file attachments."),
  li("Submissions are rate-limited per source to deter abuse. Server-side validation enforces field lengths, email format, and allowed attachment types."),
  li("Submitted ideas arrive with status 'New'. The portal never exposes internal fields such as admin comments or overlap analysis."),

  h2("7.2 Reviewing Ideas"),
  p("Users with the 'review ideas' permission work the queue. The idea lifecycle is: New → Under Review → Approved → Converted, with Rejected available as an off-ramp; an idea can be reopened from Rejected. 'Converted' is terminal — once an idea has become a project it can't be edited further."),
  li("Reviewers can change status, add internal admin comments (never shown to the public), and view any attachments via secure download links."),
  li("When an idea's status changes, the submitter is notified by email if they provided an address (best effort)."),

  h2("7.3 Converting an Idea to a Project"),
  p("Users with the 'convert ideas' permission can promote an approved idea. The application pre-fills a new-project form from the idea (name, description, urgency mapped to priority, requested date, stakeholders); the reviewer can adjust any field before creating the project. On success the idea is marked Converted and linked to the new project, and the action is audited."),

  h2("7.4 Overlap Analysis"),
  p("To help reviewers spot duplicates, an idea can be checked for overlap against existing projects and ideas. When AI is enabled (Section 11), this uses a model to explain likely overlaps; when AI is off, a keyword-based heuristic always provides a useful fallback. The result is cached on the idea and refreshed on demand."),

  // ===================================================================
  h1("8. The Roadmap"),
  p("The roadmap is a single page (permission: view the roadmap) offering four interchangeable views of the project portfolio. Administrator-type projects are excluded from all roadmap views so internal/operational work doesn't clutter the portfolio picture."),
  h2("8.1 Timeline (Gantt)"),
  li("Projects render as bars across a calendar, with selectable granularity (weeks / months / quarters) and a 'today' marker."),
  li("Bars can be dragged to adjust the target date; dependency arrows indicate upstream/downstream relationships and their health."),
  h2("8.2 Kanban"),
  li("Projects are arranged in columns by a chosen field (status, phase, priority, project type, or roadmap bucket), with optional swimlanes and per-column work-in-progress limits."),
  li("Dragging a card between columns updates the underlying field on the project. Named Kanban configurations can be saved and reused."),
  h2("8.3 Bubble (Portfolio Scatter)"),
  li("A scatter plot positioning projects on configurable axes (default: complexity vs. priority), with bubble size and color also configurable."),
  li("On the default axes, the four quadrants use the administrator-defined portfolio labels (Quick Win, Major Bet, Fill-In, Deprioritize; see Section 14)."),
  h2("8.4 Now / Next / Later"),
  li("A communication-oriented board with Now, Next, and Later columns plus an 'Unplaced' lane, driven by each project's roadmap bucket. Cards can be dragged between columns; the application can also suggest placement."),

  // ===================================================================
  h1("9. Velocity & Throughput Dashboard"),
  p("The velocity dashboard (permission: view velocity) reports delivery trends. Metrics are computed on demand and cached briefly for performance. Administrator-type projects are excluded from these metrics."),
  li("Completed projects by quarter."),
  li("Average time to completion (lead time and cycle time) by project type and over time."),
  li("Estimated vs. actual duration, with a note of any projects excluded for missing/unparseable estimates."),
  li("Task throughput per week."),
  li("Average time projects spend in each phase."),
  li("Time projects spend blocked, by quarter."),
  li("Idea conversion rate, overall and by quarter."),
  p("Filters let you scope by date range, project type, application/product, project lead, and (for the current user) individual. Where data is sparse or approximate, charts carry a clear 'Approximate' or 'Insufficient data' badge so readers don't over-trust thin numbers."),

  // ===================================================================
  h1("10. Key Capabilities"),
  p("The Key Capabilities dashboard (Insights) highlights the strategic projects the team is committing to, grouped by the quarter each is slotted for. Viewing the dashboard needs only project access; designating capabilities and assigning quarters requires the 'manage key capabilities' permission (Admin by default)."),
  li("An administrator (or other permitted user) flags a project as a key capability and optionally commits it to a quarter. At most two key capabilities may be slotted per quarter."),
  li("Each card shows the project's identity and health, a task-progress strip (open / past-due / blocked / done) and an 'x / x tasks complete' indicator with a percentage. Canceled tasks are excluded from that completion math so they don't distort the percentage."),
  li("Beneath the progress indicator, each card shows the project's most recent status note (Section 5.3); cards with no note recorded show a blank placeholder."),

  // ===================================================================
  h1("11. Health Scoring"),
  p("Every project carries an automatically computed health score — Green, Yellow, or Red — plus a rolling history used to draw a small trend sparkline. The score is recomputed when a project's status changes and when its tasks change."),
  h2("11.1 How the Score Is Determined"),
  p("The score is driven by a set of factors weighed against administrator-configurable thresholds. In summary:"),
  li("Red is triggered by any serious condition: the project status is Blocked; the target date has passed and the project isn't closed; the share of tasks blocked or overdue is at/above the Red threshold; or a hard upstream dependency is blocked."),
  li("Yellow is triggered by warning conditions when Red doesn't apply: the blocked/overdue share is at/above the Yellow threshold; the target date is near while a meaningful share of tasks are still open; a meaningful share of open tasks are individually due soon; there's been no task activity for a configured number of days; or an upstream dependency is at risk."),
  li("Green is the default when none of the above applies. Completed and Canceled projects are treated as Green."),
  li("Canceled tasks are excluded from the task-share calculations so they don't drag a project's health down."),
  h2("11.2 Thresholds and Recalculation"),
  li("The thresholds are set in Admin → Configuration → Health Thresholds (Section 14): the Yellow and Red blocked-or-overdue percentages, the inactivity day count, the target-date proximity window, and the open-task and due-soon percentages. The Red percentage must exceed the Yellow percentage."),
  li("Threshold changes apply to a project the next time it is recalculated (on its next edit, or via the daily processes). To apply new thresholds across all projects immediately, use the 'Recalculate now' action on the Health Thresholds page."),
  li("The score history keeps one point per calendar day (the latest recompute that day wins) over a rolling window, and is preserved after a project closes."),
  li("A health degradation (Green→Yellow or Yellow→Red) raises a notification; recoveries do not."),

  // ===================================================================
  h1("12. Notifications"),
  p("Praxis delivers notifications both in-app and (optionally) by email. There are seven notification types: Task Assigned, Task Due Soon, Task Overdue, Project Blocked, Dependency Blocked, Health Score Changed, and Idea Status Changed."),
  h2("12.1 Delivery and Preferences"),
  li("Each user can set, per type, whether they receive it in-app only or by email and in-app, on their Notification Preferences page. They can also enable a daily digest, which batches their emails into one message."),
  li("Administrators set the organization-wide defaults (per type, plus the default digest behavior) — the fallback applied when a user hasn't set their own preference. These defaults are part of the application settings (Section 14)."),
  li("Idea Status Changed notifications go to the idea's submitter by email (submitters have no account, so there is no in-app entry for them)."),
  h2("12.2 The Daily Sweep"),
  p("A scheduled job runs once a day (07:00 UTC via Vercel Cron) and performs four idempotent phases: notify on tasks due soon, notify on overdue tasks, send digest emails to users who opted into digests, and purge old read notifications. Running it more than once a day produces no duplicate notifications."),
  li("Administrators with the 'run notifications sweep' permission can trigger the sweep on demand from Admin → Notifications — useful for testing notification rules or as a manual fallback. The page reports counts for each phase."),
  li("The scheduled endpoint is protected by a shared secret (the CRON_SECRET environment variable); the on-demand trigger is protected by the permission and session. See Sections 15–16 for the operational details."),

  // ===================================================================
  h1("13. Task Templates"),
  p("Task templates (Admin → Task Templates; permission: manage task templates) are reusable, ordered task lists that can prefill a new project, so recurring project shapes don't have to be rebuilt by hand."),
  li("A template has a name, the project type(s) it applies to, and an ordered list of tasks."),
  li("Each template task carries a name, optional description, a default priority, an optional hour estimate, and optional dependencies on other tasks within the same template."),
  li("Tasks can be reordered with up/down controls (keyboard accessible). Edits are local until saved."),
  li("When a template is applied to a project, each template task becomes a real task with a fresh identifier, and the within-template dependencies are rewritten to point at the newly created tasks."),

  // ===================================================================
  h1("14. Administration Console Reference"),
  p("The Admin section groups all configuration into two tabbed workspaces plus several dedicated pages. Each tab and page is gated by its own permission, so access can be delegated narrowly. Older direct URLs (for example /admin/users) redirect into the appropriate workspace tab."),

  h2("14.1 Configuration Workspace"),
  p("Admin → Configuration gathers the settings that shape project data and reporting."),
  h3("Custom Fields"),
  li("Define additional fields that appear on every project. Each field has a key (a stable identifier, lowercase letters/digits/underscores, starting with a letter), a label, a type (text, number, date, yes/no, or single-select), an optional 'required' flag, and — for single-select — a list of options."),
  li("Caution: a field's key is its permanent storage handle. Renaming a key after projects have used the field orphans the existing data under the old key. Change the label freely, but treat the key as fixed once in use."),
  h3("Project Values"),
  li("Extend the four project enums — Status, Phase, Priority, and Application/Product — with your own values. Built-in values are shown but locked."),
  li("Each custom value has an immutable id and an editable label. Status values add 'is open' and 'is terminal' flags; phases add an order; priorities add a rank to position them."),
  li("Values can be archived (hidden from new dropdowns while preserved on records that use them) or deleted (only when never used). As with custom-field keys, the id is permanent once in use — archive rather than rename."),
  h3("Portfolio Quadrants"),
  li("Rename the four strategic-position labels used in the Projects table, Kanban cards, and the bubble chart's default axes: Quick Win, Major Bet, Fill-In, Deprioritize. Labels are free text. Renaming a label does not move any project — quadrant membership is computed from priority and complexity, not from the label."),
  h3("Health Thresholds"),
  li("Set the six values that drive the health score (Section 11): the Yellow and Red blocked-or-overdue percentages, the inactivity days, the target-date proximity days, the open-task percentage, and the due-soon-task percentage. Red must be greater than Yellow. A 'Recalculate now' action reapplies the thresholds across all projects immediately."),
  h3("AI"),
  li("Choose which AI model backs each of the three AI features (Section 11/15). This tab appears only when AI is enabled in the environment. Models are picked from the live list the account can invoke; if that list can't be loaded you can paste a model id manually."),

  h2("14.2 Resource Management Workspace"),
  p("Admin → Resource Management gathers people and access settings."),
  h3("Users"),
  li("Invite, change roles, deactivate/reactivate, and reset passwords (Section 4)."),
  h3("Roles & Permissions"),
  li("Edit the role-to-permission matrix (Section 3.4)."),
  h3("Resource Thresholds"),
  li("Tune how the Resources page computes workload and performance. This includes the default per-resource allocation percentage; the weights that build a workload score (per project assignment, per open task, per past-due task, per bottleneck task, and multipliers by complexity and priority); the workload bucket boundaries (Light / Balanced / Heavy / Overloaded, which must be in increasing order); the performance score weights (on-time rate and the inverse of blocked rate); the performance thresholds (Yellow and Green minimums, which must be ordered); and the look-back window in days for the performance math."),

  h2("14.3 Dedicated Admin Pages"),
  li("Task Templates — Section 13."),
  li("Notifications — run the daily sweep on demand and view per-phase counts (Section 12)."),
  li("Ideas review queue — triage and convert submissions (Section 7); gated by the idea permissions rather than an admin permission."),
  li("Audit Log — Section 15."),

  h2("14.4 The Settings Record"),
  p("All of the above (health thresholds, branding, notification defaults, custom field definitions, saved Kanban configurations, the role-permission map, project-value extensions, resource settings, portfolio quadrant labels, and AI model selection) persists in a single application settings record. The application reads it defensively, so a settings record missing a newer field still loads with sensible defaults."),

  // ===================================================================
  h1("15. Audit Log"),
  p("The audit log (Admin → Audit Log; permission: view audit log) is an append-only record of who changed what. Entries are never edited or deleted after they're written."),
  li("Each entry records when it occurred, the actor (or 'system' for automated changes, with the actor's name denormalized so it survives later renames), the entity type (Project, Task, Idea, User, Decision, Template, or Settings) and its label, the action, and a short human-readable summary such as 'Status: In Progress → Blocked'."),
  li("Actions recorded include create, update, delete, status change, convert, invite, deactivate, activate, role change, and password reset."),
  li("The page supports filtering by entity type, by action, and by actor (including system), plus a free-text search over the entity label and summary. Results are newest-first."),
  li("Auditing is best-effort and never blocks the underlying operation — a write succeeds even if its audit entry can't be recorded — so the log should be read as a strong record of activity, not a transactional guarantee."),

  // ===================================================================
  h1("16. Deployment & Environment"),
  p("Praxis runs on Vercel against a Supabase project. The following environment variables govern a deployment; set them in the Vercel project settings for production and in a local .env file for development."),
  h2("16.1 Required Variables"),
  li("NEXT_PUBLIC_SUPABASE_URL — the Supabase project URL."),
  li("NEXT_PUBLIC_SUPABASE_ANON_KEY — the browser-safe Supabase key."),
  li("SUPABASE_SERVICE_ROLE_KEY — the server-only Supabase key. It bypasses row-level security and must never be exposed to the browser or committed to source control; rotate it immediately if it leaks."),
  li("NEXT_PUBLIC_SITE_URL — the canonical site URL, used to build invite and recovery links (required in production)."),
  li("CRON_SECRET — the shared secret the daily notification sweep endpoint requires (required in production)."),
  h2("16.2 Optional Variables"),
  li("RESEND_API_KEY and RESEND_FROM — enable and address transactional email; without them, email content is logged instead of sent."),
  li("AI_ENABLED — set to 'true' to turn on the AI features. Unset/false disables them (the endpoints then refuse to run)."),
  li("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY — long-lived IAM-user credentials for AWS Bedrock, required when AI is enabled (see Section 11/Appendix)."),
  li("BEDROCK_REGION (and/or AWS_REGION) — the AWS region for Bedrock calls; defaults to us-east-1."),
  li("Seed/admin overrides (default admin email and name, seed-source path) and PPTX template path overrides exist for setup and customization."),
  h2("16.3 Supabase Auth Configuration"),
  li("In the Supabase dashboard, set the Site URL and the allowed redirect URLs to include the application's auth callback for both local and production hosts."),
  li("Customize the invite and recovery email templates to point at the application's auth callback route, passing the token as query parameters (this is what the interstitial in Section 2.4 relies on)."),
  h2("16.4 The Daily Cron"),
  li("A Vercel Cron entry calls the notification sweep endpoint daily at 07:00 UTC with the CRON_SECRET. The job is tuned to finish well within the platform's function time limit."),

  // ===================================================================
  h1("17. Operational Scripts"),
  p("A set of maintenance scripts is run from the server (not the application UI), typically by an operator with database credentials. They are invoked with the project's package scripts. The most relevant to administrators:"),
  h2("17.1 Setup & Data"),
  li("Seed — build the initial data set and a default administrator."),
  li("Spreadsheet import — re-import ideas/projects from the source spreadsheet; supports a dry-run before applying."),
  li("Supabase migration / auth-user migration — one-time historical steps from the original migration to Supabase; retained for reference."),
  h2("17.2 User Administration"),
  li("Bulk-create users — onboard an initial roster from a file without sending individual invite emails (it prints recovery links instead)."),
  li("Recovery link — mint a fresh recovery link for one user."),
  li("Update admin email — change an administrator's email in both the identity and profile records."),
  li("Delete user — testing only; fully removes a user from identity and profile."),
  h2("17.3 AI & Diagnostics"),
  li("List models — print the Bedrock models the account can invoke (used to choose AI model defaults); requires AI enabled and AWS credentials."),
  li("Smoke tests — per-feature scripts that exercise core logic (database, projects, tasks, roadmap, export, decisions, notifications, health, velocity, ideas, templates, and the admin-exclusion rule). Useful as a post-deploy sanity check."),
  li("Run the notification sweep — manually invoke the daily sweep from the server (handy in development, where the scheduled cron only runs in production)."),

  // ===================================================================
  h1("18. AI Advisor"),
  p("Praxis includes three optional AI features. All three are gated by the AI_ENABLED environment flag; when it is off, the feature endpoints decline to run and the idea-overlap feature falls back to its keyword heuristic so it always returns something useful."),
  li("Complexity & time estimate — suggests a project's complexity and a rough time estimate from its description. Runs on demand from the project form."),
  li("Priority recommendation — reasons across the open-project list and proposes a ranking, presented for review rather than applied automatically."),
  li("Idea overlap — compares a submitted idea against existing projects and ideas to surface likely duplicates (Section 7.4)."),
  h2("18.1 Models and Credentials"),
  li("Each feature's model is chosen by an administrator on the Admin → Configuration → AI tab, from the live list of models the account can invoke. By convention the high-volume estimate uses a fast, economical model and the reasoning-heavy features use a stronger one."),
  li("The features call AWS Bedrock using long-lived IAM-user access keys. This replaced an earlier approach based on interactive SSO sign-in, which could not refresh in the hosting environment; the IAM-user keys do not expire and so work in production once provided."),
  li("Region policies matter: some Bedrock model 'inference profiles' route across regions and can be blocked by an organization's region-whitelist policy. The model picker labels each option with its routing scope so an administrator can choose one that stays within allowed regions."),
  li("Whether AI is actually active in a given deployment depends on AI_ENABLED and the presence of valid AWS credentials in that environment. Treat enabling AI as a deliberate decision (cost and data-handling), and confirm the chosen models are reachable from your region before relying on them."),

  // ===================================================================
  h1("Appendix A: Permission Catalog"),
  p("The complete set of permissions, by category, with what each allows. The default column notes which non-Admin roles receive it by default (PL = Project Lead, TM = Team Member, V = Viewer); Admin always has all of them."),
  h2("Projects"),
  li("View projects — see the project list, detail pages, and quick views. Default: PL, TM, V."),
  li("Create projects — add new projects. Default: PL."),
  li("Edit projects — update fields on existing projects. Default: PL."),
  li("Delete projects — permanently remove projects (cancellation is a status, not a delete). Default: Admin only."),
  h2("Tasks"),
  li("View tasks — see the tasks page and task detail panels across all projects. Default: PL, TM, V."),
  li("Create tasks — add tasks under a project. Default: PL, TM."),
  li("Edit tasks — update task status, assignees, due dates, and other fields. Default: PL, TM."),
  li("Delete tasks — permanently remove tasks. Default: PL."),
  li("Move tasks between projects — reassign a task to a different project. Default: PL."),
  h2("Ideas"),
  li("Review submitted ideas — open the queue and approve, reject, or comment. Default: PL."),
  li("Convert ideas to projects — promote an approved idea into a project. Default: PL."),
  h2("Roadmap"),
  li("View the roadmap — open the Timeline, Kanban, Bubble, and Now/Next/Later views. Default: PL, TM, V."),
  li("Export roadmap to PPTX — generate the PowerPoint deck from any roadmap view. Default: PL."),
  h2("Insights"),
  li("View velocity dashboard — open the velocity & throughput dashboard. Default: PL, TM, V."),
  li("Manage key capabilities — designate projects and assign quarters (max two per quarter). Default: Admin only."),
  li("View Resources insights — open Insights → Resources (defaults to your team). Default: PL."),
  li("View all resources — see every resource, not just your team. Default: PL."),
  h2("Administration"),
  li("Access the Admin section — reveals the Admin group in navigation; required for any admin page. Default: Admin only."),
  li("Manage users — invite, change roles, deactivate, reset passwords. Default: Admin only."),
  li("Manage roles & permissions — edit the role-permission matrix. Default: Admin only."),
  li("Manage custom fields — add/edit/remove project custom fields. Default: Admin only."),
  li("Manage task templates — create and maintain task templates. Default: Admin only."),
  li("Manage health score thresholds — tune the Red/Yellow/Green thresholds. Default: Admin only."),
  li("Manage resource thresholds — tune workload and performance settings. Default: Admin only."),
  li("Manage project values — add/rename/archive Status/Phase/Priority/Application values. Default: Admin only."),
  li("Manage portfolio quadrants — rename the four strategic-position labels. Default: Admin only."),
  li("Manage AI model selection — choose the Bedrock model per AI feature. Default: Admin only."),
  li("Run notifications sweep — trigger the daily sweep on demand. Default: Admin only."),
  li("View audit log — open the Admin → Audit Log page. Default: Admin only."),

  // ===================================================================
  h1("Appendix B: Status, Phase & Priority Reference"),
  h2("Project Status (built-in)"),
  p("Not Started, In Planning, In Progress, Blocked, On Hold, Delayed, Completed, Canceled. Extensible by administrators; each custom status carries 'is open' and 'is terminal' flags."),
  h2("Project Phase (built-in)"),
  p("Qualification, Prioritization, Planning, Data Modeling, Application Development, Customer Validation, Deployment Readiness, Handover, Closeout. Extensible by administrators; ordering preserved by an order value."),
  h2("Priority (built-in)"),
  p("Critical, High, Medium, Low. Extensible by administrators; each custom priority carries a rank to position it."),
  h2("Task Status (fixed)"),
  p("Not Started, Awaiting Dependency, In Progress, Blocked, Delayed, On Hold, Complete, Canceled. NOT extensible — these statuses are relied upon by the auto-unblock cascade and the health score."),

  // ===================================================================
  h1("Appendix C: Page & Navigation Inventory"),
  h2("Everyday Pages"),
  li("Home — at-a-glance summary and recent activity."),
  li("Projects — the project list and detail/quick-view panels."),
  li("Tasks and My Tasks — all tasks, and the current user's tasks."),
  li("Roadmap — Timeline, Kanban, Bubble, Now/Next/Later (one page, four views)."),
  li("Insights — Velocity dashboard, Resources, and Key Capabilities."),
  li("Ideas — the review queue (for permitted users)."),
  li("Profile → Notifications — per-user notification preferences."),
  li("Submit — the public idea-submission portal (no sign-in)."),
  h2("Admin Pages"),
  li("Configuration — Custom Fields, Project Values, Portfolio Quadrants, Health Thresholds, AI."),
  li("Resource Management — Users, Roles & Permissions, Resource Thresholds."),
  li("Task Templates, Notifications, Ideas review, and Audit Log."),
  h2("Auth Pages"),
  li("Login, Forgot Password, Reset Password, and the invite-acceptance flow."),
  li("403 — the styled 'not authorized' landing page."),

  gap(),
  p("— End of Administrator Guide —"),
];

// ---------------------------------------------------------------------------
// XML helpers (mirror scripts/generate-design-doc-v2.ts)
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraphXml(para: Para): string {
  const text = escapeXml(para.text);
  const pPr =
    para.style === "Normal"
      ? ""
      : `<w:pPr><w:pStyle w:val="${para.style}"/></w:pPr>`;
  const run =
    para.text === ""
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
// Main: load an existing .docx as a style template, swap document.xml.
// ---------------------------------------------------------------------------

async function main() {
  const root = resolve(__dirname, "..");
  // Reuse the design-doc styles (Title/Subtitle/Heading1-3/ListParagraph).
  const templatePath = join(root, "IIM_Application_Design_Requirements.docx");
  const outPath = join(root, "Praxis_Administrator_Guide.docx");

  const templateBuf = readFileSync(templatePath);
  const zip = await JSZip.loadAsync(templateBuf);

  zip.file("word/document.xml", buildDocumentXml(paragraphs));

  const coreFile = zip.file("docProps/core.xml");
  if (coreFile) {
    const coreXml = await coreFile.async("string");
    const updated = coreXml.replace(
      /<dc:title>[^<]*<\/dc:title>/,
      `<dc:title>Praxis - Administrator Guide</dc:title>`,
    );
    zip.file("docProps/core.xml", updated);
  }

  const out = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(outPath, out);

  console.log(
    `Wrote ${outPath} (${out.length} bytes, ${paragraphs.length} paragraphs).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
