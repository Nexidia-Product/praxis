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
 *
 * Step-by-step procedures are written as "How to:" Heading3 blocks
 * followed by numbered ListParagraph steps (the template's ListParagraph
 * style is a plain indent with no bullet glyph, so a "1." prefix renders
 * as a clean numbered list). Use the proc() helper to build them.
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

/** A "How to:" procedure: a Heading3 title + auto-numbered steps. */
const proc = (title: string, ...steps: string[]): Para[] => [
  h3(title),
  ...steps.map((t, i) => li(`${i + 1}. ${t}`)),
];

// ---------------------------------------------------------------------------
// Document body — Praxis Administrator Guide.
// ---------------------------------------------------------------------------

const paragraphs: Para[] = [
  gap(),
  gap(),
  { style: "Title", text: "Praxis" },
  { style: "Subtitle", text: "Administrator Guide" },
  gap(),
  p("Version 1.1  |  June 2026"),
  gap(),
  p("This guide is written for administrators of Praxis — the people who set up the application, manage users and access, tune how the system scores and reports on work, and keep it running day to day. It explains what every part of the application does, how an administrator controls it, and gives step-by-step instructions for each common task. No prior familiarity with the codebase is assumed."),
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
  li("Front end and server: a Next.js application. Pages render server-side and call internal service modules for all reads and writes."),
  li("Database and identity: Supabase (PostgreSQL) stores all application data; Supabase Auth owns user identity (email/password). The application profile — name, role, active flag, preferences — lives in a users table joined to the auth identity."),
  li("Hosting: deployed on Vercel. A daily Vercel Cron job drives the notification sweep (Section 12)."),
  li("AI: the optional AI features call AWS Bedrock. They are controlled by an environment flag and per-feature model selection (Section 18)."),
  li("Email: transactional email (invites, recovery, notifications) is sent through Resend when configured; otherwise email content is logged for development."),

  h2("1.4 How This Guide Is Organized"),
  li("Sections 2–4 cover access and security: authentication, roles and permissions, and user management — the first things to set up."),
  li("Sections 5–7 cover the core records you manage: projects, tasks, and ideas."),
  li("Sections 8–13 cover the views, dashboards, and system features built on top of those records."),
  li("Section 14 is the Administration Console reference — every configuration surface in one place."),
  li("Sections 15–18 cover the audit log, deployment and environment, operational scripts, and the AI advisor."),
  li("Throughout, look for \"How to:\" blocks — numbered, click-by-click procedures for each task. On-screen labels are quoted exactly (for example, the \"+ New project\" button)."),
  li("The appendices provide quick-reference tables: the full permission catalog, the status/phase/priority reference, and a page inventory."),

  h2("1.5 Getting Around"),
  p("Once signed in, you navigate from the left sidebar, which is grouped into Workspace (Projects, Tasks, My tasks), Insights (Key capabilities, Ideas, the velocity dashboard, Resources), and — for administrators — Admin (Resource management, Configuration, Templates, Notifications, Audit log). A global search box sits in the top header."),
  ...proc(
    "How to: Find a project, task, or idea with global search",
    "Click the search box in the top header (placeholder \"Search projects, tasks, ideas…\"), or press Ctrl+K (Windows) / Cmd+K (Mac) from anywhere.",
    "Type at least two characters. A results dropdown appears, grouping matches by type (projects, tasks, and — if you can review ideas — ideas).",
    "Use the Up/Down arrow keys to move between results and press Enter, or click a result, to open it.",
    "Press Escape to close the dropdown without navigating.",
  ),

  // ===================================================================
  h1("2. Authentication & Access"),
  h2("2.1 Identity Model"),
  p("Identity is owned by Supabase Auth. Users sign in with an email address and password; Praxis never stores or sees a plaintext password — Supabase hashes and stores it. Each signed-in identity is matched to an application profile record that carries the user's display name, role, active flag, and notification preferences."),
  p("Deactivated accounts are treated as not signed in: the session resolver returns nothing for them, so a deactivated user is locked out on their next request without their history being deleted."),

  h2("2.2 Sessions"),
  li("Sessions are cookie-based. Middleware refreshes the session on every request so short-lived access tokens are renewed transparently."),
  li("Signing out clears the session cookies. Session lifetime otherwise follows Supabase Auth's token settings."),

  h2("2.3 Signing In and Recovering a Password"),
  ...proc(
    "How to: Sign in",
    "Go to the application URL; if you aren't signed in you land on the login page.",
    "Enter your address in the \"Email\" field and your password in the \"Password\" field.",
    "Click \"Sign in\" (it shows \"Signing in…\" while it works). You're taken to the home page.",
  ),
  ...proc(
    "How to: Reset your own password",
    "On the login page, click \"Forgot password?\".",
    "On the \"Forgot your password?\" page, enter your address in the \"Email\" field and click \"Send reset link\".",
    "You'll see a generic confirmation (\"If an account with that email exists, we've sent a password reset link.\"). Check your inbox; the link expires in one hour.",
    "Open the link, enter a new password in \"New password\" and again in \"Confirm password\" (rules: at least 12 characters with three of lowercase, uppercase, digit, special character), and click \"Update password\".",
    "You're returned to the login page to sign in with the new password.",
  ),
  p("New users are brought in through an invitation rather than self-registration (Section 4.2). An invited user follows their link to a \"Set your password\" page, chooses a password, and is signed in."),

  h2("2.4 Why Email Links Use an Interstitial Page"),
  p("Invite and recovery links carry a single-use token. Corporate email security (link prefetchers such as Microsoft Defender Safe Links, and chat unfurlers) often fetch a link before the human clicks it. If the link were a plain request that consumed the token, the prefetcher would burn it and the real user would arrive to an 'invalid link' error."),
  p("To prevent that, the authentication callback responds with a small HTML page that immediately submits a form to complete the verification. Prefetchers follow links but do not submit forms, so the token survives until the human actually clicks. This is invisible to users and needs no administrator action, but it explains the brief 'verifying…' page after a click. If you customize Supabase's email templates, keep the callback URL format intact (the token passed as query parameters to the callback route)."),

  // ===================================================================
  h1("3. Roles & Permissions"),
  h2("3.1 The Four Roles"),
  p("Every user holds exactly one role. Roles are hierarchical in spirit — Admin is the most privileged, Viewer the least — but what a role can actually do is determined entirely by the permissions mapped to it (Section 3.3), not by the role name."),
  li("Admin — full control. Admin always has every permission in the catalog, and this cannot be edited or removed. There is no way to misconfigure an Admin into being locked out."),
  li("Project Lead — manages projects, tasks, and the idea pipeline, can export the roadmap, and can see all resources. By default cannot reach the Admin console."),
  li("Team Member — works on projects and tasks (view/create/edit tasks, view projects) and views the roadmap and velocity dashboard."),
  li("Viewer — read-only access to projects, tasks, the roadmap, and the velocity dashboard."),

  h2("3.2 The Permission Catalog"),
  p("The application defines 29 permissions, grouped into six categories. A permission is the unit of access enforced throughout the app — each protected page and action checks for a specific permission key. The full catalog with descriptions is in Appendix A; the categories are:"),
  li("Projects (4): view, create, edit, delete. Deleting a project is distinct from canceling it — cancellation is a status, deletion permanently removes the record."),
  li("Tasks (5): view, create, edit, delete, and move (reassign a task to a different project)."),
  li("Ideas (2): review (work the submission queue) and convert (promote an approved idea into a project)."),
  li("Roadmap (2): view the roadmap, and export it to PowerPoint."),
  li("Insights (4): view the velocity dashboard, manage key capabilities, view Resources (defaults to your team), and view all resources (the full org roster)."),
  li("Administration (12): access the Admin section, plus a separate permission for each admin surface — manage users, roles & permissions, custom fields, task templates, health thresholds, resource thresholds, project values, portfolio quadrants, AI model selection, run the notifications sweep, and view the audit log."),
  p("Because each admin surface is gated separately, you can delegate a narrow slice of administration — for example, let a Project Lead manage task templates without giving them user management — by granting just that one permission to their role. Granting any admin permission is only useful alongside 'Access the Admin section', which reveals the Admin group in the navigation."),

  h2("3.3 Default Role-to-Permission Mapping"),
  p("On first run, each role is seeded with these defaults. You can change them at any time (Section 3.4); Admin is fixed at the full set."),
  li("Project Lead: view/create/edit projects; view/create/edit/delete/move tasks; review and convert ideas; view and export the roadmap; view velocity; view resources and view all resources."),
  li("Team Member: view projects; view/create/edit tasks; view the roadmap; view velocity."),
  li("Viewer: view projects; view tasks; view the roadmap; view velocity."),
  li("None of the non-Admin roles has any Administration permission by default."),

  h2("3.4 Editing Roles & Permissions"),
  p("The role-to-permission mapping is data, not code, so you can reshape who can do what without a software change. The editor is a matrix: permissions are rows (grouped by category); roles are columns. The Admin column is shown but locked."),
  ...proc(
    "How to: Change what a role can do",
    "In the left sidebar under Admin, open \"Resource management\", then the \"Roles & permissions\" tab.",
    "Find the permission row and the role column you want to change, and click the checkbox to grant or revoke that pair. (The Admin column is faded and cannot be changed.)",
    "Repeat for any other pairs. Your edits are pending until you save.",
    "Click \"Save changes\". To abandon edits, click \"Discard changes\"; to return every non-Admin role to its seeded defaults, click \"Reset to defaults\" (you'll confirm in a dialog, then still need to Save).",
    "Caution: if you grant a role an admin permission but not 'Access the Admin section', the page won't appear in their navigation. A heads-up banner flags this; grant 'Access the Admin section' alongside other admin permissions.",
  ),

  h2("3.5 How Access Is Enforced"),
  li("Signed-in vs. not is enforced globally; a small set of public routes (login, forgot/reset password, the invite acceptance flow, the public idea-submission portal and its API, and the auth callback) need no session."),
  li("Beyond that, every protected page and action checks for a specific permission. A signed-in user who lacks the permission for a page is redirected to a styled '403 — not authorized' page that shows their current role; API calls return a 403 response."),

  // ===================================================================
  h1("4. User Management"),
  p("User management lives under Admin → Resource management → Users (permission: manage users). The page lists every user with their name, email, role, status, and last sign-in, plus per-user actions. Status tags are: Active, Invited (invitation pending), Reset pending (a reset link was issued), and Deactivated."),

  ...proc(
    "How to: Invite a new user",
    "Open Admin → Resource management → Users.",
    "Click \"Invite user\". The invite form appears with \"Name\", \"Email\", and \"Role\" (Admin / Project Lead / Team Member / Viewer; defaults to Team Member).",
    "Fill in the name and email, choose the role, and click \"Send invite\".",
    "A banner confirms the result (\"Invite emailed\" or \"Invite created\") and shows the invite link, which expires in 14 days. If email isn't configured, click \"Copy\" and share the link directly; otherwise it has also been emailed. Click \"Dismiss\" to close the banner.",
  ),
  ...proc(
    "How to: Change a user's role",
    "Open Admin → Resource management → Users.",
    "On the user's row, open the dropdown in the \"Role\" column and choose the new role. The change saves immediately and is recorded in the audit log.",
    "Note: your own row is locked (marked \"you\") — you cannot change your own role.",
  ),
  ...proc(
    "How to: Deactivate or reactivate a user",
    "Open Admin → Resource management → Users.",
    "On the user's row, in the \"Actions\" column, click \"Deactivate\" (or \"Reactivate\" for a deactivated account). The change applies immediately.",
    "A deactivated user is locked out on their next request; their record and history are preserved. You cannot deactivate your own account.",
  ),
  ...proc(
    "How to: Send a password reset",
    "Open Admin → Resource management → Users.",
    "On the user's row, in the \"Actions\" column, click \"Reset password\" (it shows \"Sending…\").",
    "A banner shows the reset link (valid one hour). If email isn't configured, click \"Copy\" and share it directly. (The button is disabled for deactivated users — reactivate them first.)",
  ),
  p("Several user operations are also available as server-side scripts (Section 17) for bulk onboarding or recovery when the UI or email isn't an option."),

  // ===================================================================
  h1("5. Projects"),
  p("A project is the central record in Praxis. Each project has an auto-assigned identifier in the form YYYY-NNN (year of creation plus a sequence number, e.g. 2026-001)."),

  h2("5.1 Project Fields"),
  li("Identity: name, description, and a definition of done (what 'done' looks like)."),
  li("Classification: application/product, project type, priority, phase, and status."),
  li("People: a project lead (required) and additional resources (registered users and/or free-text names), plus primary stakeholders, and a per-resource allocation percentage."),
  li("Dates: a target date and a start date (the start date is auto-set the first time a project moves into an active status, unless already set)."),
  li("Roadmap bucket: a free-text grouping used by the Now/Next/Later board; new projects default to 'Unplaced'."),
  li("Health: a computed Red/Yellow/Green score with a rolling history (Section 11)."),
  li("AI fields: an AI complexity score and time estimate (Section 18), when AI is enabled."),
  li("Custom fields: any administrator-defined fields (Section 14) appear on every project."),
  li("Links and dependencies: document links, internal project-to-project dependencies, and external dependencies."),
  li("Key capability: a flag and an optional committed quarter (Section 10)."),

  h2("5.2 Status, Phase, and Priority"),
  p("Projects carry three lifecycle dimensions, all of which administrators can extend (Section 14):"),
  li("Status (built-in): Not Started, In Planning, In Progress, Blocked, On Hold, Delayed, Completed, Canceled. Administrator-added statuses carry 'is open' and 'is terminal' flags."),
  li("Phase (built-in): Qualification, Prioritization, Planning, Data Modeling, Application Development, Customer Validation, Deployment Readiness, Handover, Closeout. Administrator-added phases carry an order value."),
  li("Priority (built-in): Critical, High, Medium, Low. Administrator-added priorities carry a rank."),

  h2("5.3 Working with Projects"),
  ...proc(
    "How to: Create a new project",
    "In the sidebar, click \"Projects\".",
    "Click \"+ New project\" (top-right of the toolbar). The \"New project\" form opens.",
    "Fill in the form. The required fields are \"Name\" and \"Application/Product\"; the form also offers \"Description\", \"Definition of done\", \"Type\", \"Priority\", \"Status\", \"Phase\", \"Complexity\", \"Time estimate\", \"Start date\", \"Target date\", \"Project lead\", \"Primary stakeholders\", \"Additional resources\" (and per-resource \"Allocations\"), and — when available — \"Apply task template\", \"Depends on\", \"Document & repository links\", \"External dependencies\", and any admin-defined custom fields.",
    "Click \"Create project\" (shows \"Saving…\"). The modal closes and the project appears in the table.",
  ),
  ...proc(
    "How to: Edit a project",
    "On the Projects page, click the project's row to open its quick-view panel.",
    "Click \"Edit project\" in the panel. The \"Edit project\" form opens (the same fields as create).",
    "Make your changes and click \"Save changes\".",
  ),
  ...proc(
    "How to: Change a project's status and record a note",
    "Open the project's quick-view panel (click its row on the Projects page).",
    "Open the \"Status\" tab.",
    "Choose the new status from the status control. Optionally type an explanation in the \"Summary\" note field (it archives with this change).",
    "Click \"Update status\" — or, to attach a note without changing the status, \"Add note\". The change appears in the history list below with timestamp and author.",
  ),
  ...proc(
    "How to: Add a dependency, an external dependency, or a document link",
    "Open the project form (create or edit).",
    "Internal dependency: in the \"Depends on\" section, pick an upstream project, then set its type — \"Blocks Start\" or \"Blocks Phase\" (for \"Blocks Phase\", also pick the required phase). Cycles are rejected.",
    "External dependency: in the \"External dependencies\" section, fill the \"Title\" (and optionally owner, URL, target date, description; status defaults to \"Open\") and click \"Add dependency\".",
    "Document link: in the \"Document & repository links\" section, paste a URL (the link type is auto-detected), optionally add a label, and click \"Add\".",
    "Click \"Save changes\" (or \"Create project\") to persist.",
  ),

  h2("5.4 Dependencies, Links, and Templates (Reference)"),
  li("Internal dependencies: 'Blocks Start' (upstream must finish before this starts) and 'Blocks Phase' (upstream must reach a specified phase). Cycles are detected and rejected."),
  li("External dependencies track work outside Praxis (vendor deliverables, another team's Jira ticket) with a label, owner, optional link, status (Open / In Progress / Resolved), and optional target date. They feed the health score's upstream-risk consideration."),
  li("Document links are labeled links to GitHub, Confluence, SharePoint, network drives, Figma, Miro, Jira, and generic external resources; each records who added it and when."),
  li("Applying a task template at creation creates the template's tasks on the new project with their inter-task dependencies preserved (Section 13)."),

  // ===================================================================
  h1("6. Tasks"),
  p("Tasks belong to a project and have their own auto-assigned identifiers. A task is the unit of trackable work. A task's project is fixed at creation unless it is explicitly moved (Section 6.4)."),

  h2("6.1 Task Fields and Statuses"),
  li("Fields: task name, detailed description, status, priority, a responsible owner (required) plus additional assignees, a target (due) date, an optional hour estimate, a 'blocked' flag with optional structured blocker detail, comments (with history), document links, and task-to-task dependencies."),
  li("Statuses: Not Started, Awaiting Dependency, In Progress, Blocked, Delayed, On Hold, Complete, Canceled. Unlike project values, task statuses are NOT administrator-extensible — they are relied on by the auto-unblock behavior and the health score."),

  h2("6.2 Task Dependencies and Auto-Unblock"),
  p("Tasks can depend on other tasks using the four standard relationship types (Finish-to-Start, Start-to-Start, Finish-to-Finish, Start-to-Finish). The application automates the most common case, Finish-to-Start:"),
  li("When a not-started task gains a Finish-to-Start predecessor, its status automatically becomes 'Awaiting Dependency'. Removing the last such predecessor returns it to 'Not Started'."),
  li("When a task is marked Complete, every downstream task waiting on it is checked; if all of that task's Finish-to-Start predecessors are now complete, it is automatically released back to 'Not Started'. The cascade applies only to Finish-to-Start relationships, and an explicit status set by a user always wins."),

  h2("6.3 Working with Tasks"),
  ...proc(
    "How to: Add a task",
    "In the sidebar, click \"Tasks\", then click \"+ New task\" (top-right). (You can also start from a template with \"+ From template\".)",
    "In the \"New task\" form, choose the \"Project\" (required; only open projects are listed) and enter the \"Task name\" (required).",
    "Set \"Status\" and \"Priority\" (defaults: Not Started, Medium), and optionally \"Responsible\", \"Target date\", \"Estimate (hours)\", \"Additional assignees\", and \"Comments\".",
    "If the task is blocked, tick \"This task is blocked\" and use the \"Blocked by\" options (\"Another task\", \"Another project\", or \"Other\") plus the blocker details.",
    "Click \"Create task\".",
  ),
  ...proc(
    "How to: Mark a task complete",
    "On the Tasks page, find the task's row.",
    "In the \"Actions\" column, click the green check (\"✓\"). The status changes to \"Complete\" immediately.",
    "Alternatively, open the task, set \"Status\" to \"Complete\" on the \"Details\" tab, and click \"Save changes\".",
  ),
  ...proc(
    "How to: Edit a task",
    "On the Tasks page, click the task's row to open the \"Edit task\" form.",
    "Use the \"Details\" tab to change fields, the \"Comments\" tab to read the comment history, and the \"Dependencies\" tab to manage predecessor links.",
    "Click \"Save changes\".",
  ),
  ...proc(
    "How to: Move a task to another project",
    "Open the task (click its row on the Tasks page).",
    "On the \"Details\" tab, use the \"Project\" field: choose the destination project (only open projects are listed) and click \"Move\" (shows \"Moving…\"). Health scores on both projects are recalculated and the move is audited.",
    "If you don't have the move permission, the project field is read-only and notes that a task's project can't be changed after creation.",
  ),

  h2("6.4 My Tasks"),
  ...proc(
    "How to: Use the My Tasks list and checklist",
    "In the sidebar, click \"My tasks\". It shows tasks you're responsible for or assigned to.",
    "Switch between \"List\" (a filterable, groupable table) and \"Checklist\" (a personal, reorderable list of open tasks) using the buttons at the top.",
    "In Checklist mode, drag tasks by the grip handle into the order you want; the order saves automatically and persists for next time. Tick a task's checkbox to complete it.",
  ),

  // ===================================================================
  h1("7. Ideas & the Public Submission Portal"),
  p("Ideas are lightweight proposals that can be triaged and promoted into projects. They enter through a public portal and are worked in an internal review queue (sidebar: Insights → \"Ideas\"; permission: review ideas)."),

  h2("7.1 Submitting an Idea (Public)"),
  ...proc(
    "How to: Submit an idea through the public portal",
    "Go to the public portal at /submit (no sign-in required; share this link with stakeholders).",
    "Fill in \"Your name\" (required) and optionally \"Email (optional)\" (used to send you an update when the idea is reviewed).",
    "Enter the \"Idea title\" (required) and \"Description\" (required), and choose an \"Urgency\" (Low / Medium / High / Critical).",
    "Optionally set \"Requested target date (optional)\", \"Key stakeholders (optional)\", and \"Attachments (optional)\" (up to five files, 50 MB combined).",
    "Click \"Submit idea\". A confirmation appears with a reference ID; click \"Submit another idea\" to add more.",
  ),

  h2("7.2 Reviewing and Converting Ideas"),
  p("The idea lifecycle is New → Under Review → Approved → Converted, with Rejected as an off-ramp (an idea can be reopened from Rejected). 'Converted' is terminal."),
  ...proc(
    "How to: Review an idea",
    "Open Insights → \"Ideas\". Use the filter buttons (\"Open (New + Under Review)\", \"All\", \"New\", \"Under Review\", \"Approved\", \"Rejected\", \"Converted\") to scope the list.",
    "Click \"Review\" on an idea's row to open it.",
    "Move it through review with \"Mark under review\", \"Approve\", or \"Reject\".",
    "Capture internal notes in \"Reviewer notes\" (never shown to the public) and click \"Save notes\". Download any attachments with \"Download\".",
  ),
  ...proc(
    "How to: Check an idea for overlap with existing work",
    "Open the idea (Insights → \"Ideas\" → \"Review\").",
    "In the \"Overlap check\" section, click \"Run overlap check\" (or \"Re-run check\" if one already ran). It shows likely duplicate/related projects and ideas.",
    "When AI is enabled the result is model-generated; when AI is off, a keyword-based heuristic is used. Either way the result is saved on the idea for other reviewers.",
  ),
  ...proc(
    "How to: Convert an idea into a project",
    "Open the idea and click \"Convert to project →\" (requires the convert-ideas permission).",
    "In the \"Convert to project\" form, review the pre-filled fields — \"Project name\", \"Description\", \"Application / Product\", \"Project lead\", \"Type\", \"Priority\", \"Status\", \"Phase\", \"Target date\", \"Apply template\", \"Primary stakeholders\", \"Additional resources\", and any custom fields — and adjust as needed.",
    "Click \"Create project & mark Converted\". You're taken to the new project, and the idea is marked Converted and linked to it.",
  ),

  // ===================================================================
  h1("8. The Roadmap"),
  p("The roadmap is a single page (permission: view the roadmap) offering four interchangeable views of the project portfolio: Timeline (Gantt), Kanban, Portfolio (bubble/scatter), and Now / Next / Later. Administrator-type projects are excluded from all roadmap views."),
  ...proc(
    "How to: Switch roadmap views",
    "In the sidebar, open the roadmap.",
    "Use the view tabs to choose \"Timeline\", \"Kanban\", \"Portfolio\", or \"Now / Next / Later\".",
  ),
  ...proc(
    "How to: Group the Kanban board and save a named view",
    "On the Kanban view, use the \"Columns:\" dropdown to group by Status, Phase, Priority, Project type, or Roadmap bucket. Optionally set \"Swimlanes:\".",
    "Drag a card between columns to update that field on the project.",
    "To save the arrangement, click \"Save view…\", give it a name, and click \"Save\". Reload it later from the \"Saved:\" dropdown; a loaded view can be removed with \"Delete view\".",
  ),
  ...proc(
    "How to: Re-place a project on Now / Next / Later",
    "Open the \"Now / Next / Later\" view. Projects sit in the Now, Next, Later, or Unplaced columns based on their roadmap bucket.",
    "Drag a project card to a different column and release; the project's roadmap bucket updates. (A card marked \"Auto\" was placed by suggestion until you move it.)",
  ),
  ...proc(
    "How to: Export the roadmap to PowerPoint",
    "From the roadmap, click the \"Export\" control to open the \"Export PPTX deck\" dialog (requires the export-roadmap permission).",
    "Tick the slides to include (Timeline, Kanban, Portfolio, Now / Next / Later, and built-in summary slides). Slides captured as images are marked \"CAPTURE\".",
    "Enter a \"Title\" (and optional \"Subtitle\"); review the inherited filter summary, and optionally expand branding overrides to set primary/secondary colors.",
    "Click \"Export deck\". Progress messages show capture and assembly, then the .pptx downloads.",
  ),

  // ===================================================================
  h1("9. Velocity & Throughput Dashboard"),
  p("The velocity dashboard (permission: view velocity) reports delivery trends, computed on demand and cached briefly. Administrator-type projects are excluded. It charts completed projects by quarter, time-to-completion (lead and cycle time), estimated vs. actual duration, task throughput per week, time in each phase, time spent blocked, and idea conversion rate. Where data is thin or approximate, charts carry an 'Approximate' or 'Insufficient data' badge."),
  ...proc(
    "How to: Filter the velocity dashboard",
    "Open the velocity dashboard from the sidebar.",
    "Set the \"Time range\" (30 days, 90 days, 6 months, 1 year, All time, or Custom… with start/end dates).",
    "Optionally narrow by project type, application/product, and project lead, and toggle \"Just my work\" for an individual view.",
    "Use \"Reset filters\" to clear everything at once.",
  ),
  ...proc(
    "How to: Review the Resources page",
    "In the sidebar under Insights, open \"Resources\" (permission: view Resources).",
    "Switch among the \"Overview\", \"Capacity\", and \"Performance\" tabs.",
    "Use the scope toggle to switch between \"My team\" and \"Everyone\". (\"Everyone\" requires the view-all-resources permission; otherwise it's disabled.) Workload buckets and performance bands come from the resource thresholds in Section 14.2.",
  ),

  // ===================================================================
  h1("10. Key Capabilities"),
  p("The Key Capabilities dashboard (Insights) highlights the strategic projects the team is committing to, grouped by the quarter each is slotted for. Viewing needs only project access; designating capabilities and assigning quarters requires the 'manage key capabilities' permission. At most two capabilities may be slotted per quarter."),
  li("Each card shows the project's identity and health, a task-progress strip (open / past-due / blocked / done) and an 'x / x tasks complete' indicator with a percentage. Canceled tasks are excluded from that completion math."),
  li("Beneath the progress indicator, each card shows the project's most recent status note (Section 5.3); cards with no note show a blank placeholder."),
  ...proc(
    "How to: Designate a key capability and slot it into a quarter",
    "Open the Key Capabilities dashboard (sidebar: Insights → \"Key capabilities\").",
    "In the \"Add a key capability:\" row, open the \"Select a project…\" dropdown, choose an un-flagged project, and click \"Add\".",
    "On the project's card, use the quarter dropdown to commit it to a quarter (a quarter that already holds two capabilities won't accept a third).",
    "To remove the designation, click \"Remove\" on the card.",
  ),

  // ===================================================================
  h1("11. Health Scoring"),
  p("Every project carries an automatically computed health score — Green, Yellow, or Red — plus a rolling history used to draw a small trend sparkline. The score is recomputed when a project's status changes and when its tasks change."),
  h2("11.1 How the Score Is Determined"),
  li("Red is triggered by any serious condition: the status is Blocked; the target date has passed and the project isn't closed; the share of tasks blocked or overdue is at/above the Red threshold; or a hard upstream dependency is blocked."),
  li("Yellow is triggered by warning conditions when Red doesn't apply: the blocked/overdue share is at/above the Yellow threshold; the target date is near while a meaningful share of tasks are still open; a meaningful share of open tasks are individually due soon; there's been no task activity for a configured number of days; or an upstream dependency is at risk."),
  li("Green is the default when none of the above applies. Completed and Canceled projects are treated as Green. Canceled tasks are excluded from the task-share calculations."),
  h2("11.2 Thresholds and Recalculation"),
  li("Thresholds are set in Admin → Configuration → Health thresholds (Section 14.1): the Yellow and Red blocked-or-overdue percentages, the inactivity days, the target-date proximity window, and the open-task and due-soon percentages. Red must exceed Yellow."),
  li("Threshold changes apply to a project the next time it is recalculated. To apply them across all projects immediately, use \"Recalculate now\" on the Health thresholds page."),
  li("The score history keeps one point per calendar day over a rolling window and is preserved after a project closes. A degradation (Green→Yellow or Yellow→Red) raises a notification; recoveries do not."),

  // ===================================================================
  h1("12. Notifications"),
  p("Praxis delivers notifications both in-app and (optionally) by email. There are seven types: Task Assigned, Task Due Soon, Task Overdue, Project Blocked, Dependency Blocked, Health Score Changed, and Idea Status Changed."),
  h2("12.1 Delivery and Preferences"),
  li("Each user chooses, per type, whether to receive it in-app only or by email and in-app, and may enable a daily digest that batches their emails into one message."),
  li("Administrators set the organization-wide defaults (per type, plus the default digest behavior) as part of application settings — the fallback when a user hasn't set their own preference."),
  li("Idea Status Changed notifications go to the idea's submitter by email (submitters have no account)."),
  ...proc(
    "How to: Set your personal notification preferences",
    "Open your profile's Notifications page (Profile → Notifications).",
    "For each type (e.g. \"Task assigned to me\", \"Task due soon\", \"Task overdue\", \"A project I'm on is blocked\", \"An upstream dependency is blocked\", \"Project health degrades\", \"Update on submitted ideas\"), choose \"In-app only\" or \"Email + in-app\".",
    "Optionally tick \"Daily digest mode\" to receive one summary email per day instead of per-event emails.",
    "Click \"Save preferences\".",
  ),
  h2("12.2 The Daily Sweep"),
  p("A scheduled job runs once a day (07:00 UTC via Vercel Cron) and performs four idempotent phases: notify on tasks due soon, notify on overdue tasks, send digests to users who opted in, and purge old read notifications. Running it more than once a day produces no duplicates."),
  ...proc(
    "How to: Run the notification sweep on demand",
    "Open Admin → \"Notifications\" (permission: run notifications sweep).",
    "Click \"Run sweep now\" (shows \"Running…\").",
    "Read the per-phase result counts — \"Due-soon notified\", \"Overdue notified\", \"Digests sent\", \"Old read purged\", \"Health-recalc projects\", and \"Duration\". Running again right away yields zeros, since each phase de-duplicates against entries written earlier the same day.",
  ),

  // ===================================================================
  h1("13. Task Templates"),
  p("Task templates (Admin → Templates; permission: manage task templates) are reusable, ordered task lists that prefill a new project, so recurring project shapes don't have to be rebuilt by hand. When applied, each template task becomes a real task with a fresh identifier and the within-template dependencies are rewritten to the new tasks."),
  ...proc(
    "How to: Create a task template",
    "Open Admin → \"Templates\" and click \"+ New\" (left pane).",
    "Enter a \"Template name\" and tick every applicable type under \"Project types\".",
    "Under \"Tasks\", click \"+ Add task\" for each task and set its name, priority, optional \"Hours\" estimate, and optional description. Reorder tasks with the \"↑\"/\"↓\" controls.",
    "To link tasks within the template, use \"+ Add dependency\" on a task and pick a predecessor and a type (FS / SS / FF / SF).",
    "Click \"Create template\" (or \"Save changes\" when editing an existing one).",
  ),

  // ===================================================================
  h1("14. Administration Console Reference"),
  p("The Admin section groups configuration into two tabbed workspaces plus several dedicated pages. Each tab and page is gated by its own permission, so access can be delegated narrowly. Older direct URLs redirect into the appropriate workspace tab."),

  h2("14.1 Configuration Workspace"),
  p("Admin → Configuration gathers the settings that shape project data and reporting: Custom fields, Project values, Portfolio quadrants, Health thresholds, and (when AI is enabled) AI."),
  ...proc(
    "How to: Add a custom field",
    "Open Admin → Configuration → \"Custom fields\".",
    "Click \"+ Add field\" and set the \"Label\", the \"Key\" (lowercase letters/digits/underscores, starting with a letter), and the \"Type\" (Text, Number, Date, Yes / no, or Single-select). Tick \"Required\" if needed; for Single-select, fill the comma-separated \"Options\".",
    "Click \"Save changes\".",
    "Caution: the key is the permanent storage handle. Renaming a key after projects use the field orphans the old data — change the label freely, but treat the key as fixed once in use.",
  ),
  ...proc(
    "How to: Add a project value (status / phase / priority / application)",
    "Open Admin → Configuration → \"Project values\" and pick the \"Status\", \"Phase\", \"Priority\", or \"Application / Product\" tab. (Built-in values are shown but locked.)",
    "In the add form, enter the \"Label\" and an \"ID\" (auto-derived, editable, must be unique). For Status set \"Open\"/\"Terminal\"; for Priority set \"Rank\"; for Phase set \"Order\". Click \"Add\".",
    "Click \"Save changes\". To retire a value later, \"Archive\" it (hidden from new dropdowns, preserved on records that use it); \"Delete\" is only allowed for values never used. Treat the ID as permanent once in use.",
  ),
  ...proc(
    "How to: Rename the portfolio quadrant labels",
    "Open Admin → Configuration → \"Portfolio quadrants\".",
    "Edit the four labels — \"Quick Win\", \"Major Bet\", \"Fill-In\", \"Deprioritize\" (each up to 60 characters).",
    "Click \"Save\" (or \"Reset to defaults\"). Renaming a label doesn't move any project — quadrant membership is computed from priority and complexity.",
  ),
  ...proc(
    "How to: Set health thresholds and apply them now",
    "Open Admin → Configuration → \"Health thresholds\".",
    "Set the Yellow and Red blocked-or-overdue percentages (Red must be greater than Yellow) and the Yellow-only triggers (inactivity days, target-date proximity, open-task %, due-soon task %).",
    "Click \"Save thresholds\".",
    "Click \"Recalculate now\" to apply the new thresholds across every existing project immediately (a banner reports how many changed); otherwise they apply as projects are next recalculated.",
  ),
  ...proc(
    "How to: Choose AI models per feature",
    "Open Admin → Configuration → \"AI\" (this tab appears only when AI is enabled in the environment).",
    "For each feature — \"Complexity / time estimate\", \"Priority recommendation\", and \"Idea overlap\" — pick a model from the dropdown (each option is tagged with its routing scope, e.g. on-demand / us / global). If the model list can't load, paste a model id into the text box instead.",
    "Click \"Save\" (or \"Reset to defaults\").",
  ),

  h2("14.2 Resource Management Workspace"),
  p("Admin → Resource management gathers people and access settings: Users (Section 4), Roles & permissions (Section 3.4), and Resource thresholds."),
  ...proc(
    "How to: Tune resource thresholds",
    "Open Admin → Resource management → \"Resource thresholds\".",
    "Adjust the sections: \"Default allocation\"; \"Workload weights\" (per assignment, per open task, per past-due task, per bottleneck task, plus complexity and priority multipliers); \"Workload bucket thresholds\" (Light < Balanced < Heavy max → Overloaded); \"Performance weights\" (on-time and blocked-inverse); and \"Performance score thresholds\" (Yellow min < Green min, plus the look-back window in days).",
    "Click \"Save thresholds\". The Resources page reflects the new values on next render.",
  ),

  h2("14.3 Dedicated Admin Pages"),
  li("Templates — create and maintain task templates (Section 13)."),
  li("Notifications — run the daily sweep on demand and view per-phase counts (Section 12.2)."),
  li("Audit log — Section 15."),
  li("Ideas review queue — triage and convert submissions (Section 7); gated by the idea permissions rather than an admin permission."),

  h2("14.4 The Settings Record"),
  p("All of the above (health thresholds, branding, notification defaults, custom field definitions, saved Kanban views, the role-permission map, project-value extensions, resource settings, portfolio quadrant labels, and AI model selection) persists in a single application settings record. The application reads it defensively, so a settings record missing a newer field still loads with sensible defaults."),

  // ===================================================================
  h1("15. Audit Log"),
  p("The audit log (Admin → Audit log; permission: view audit log) is an append-only record of who changed what. Entries are never edited or deleted after they're written."),
  li("Each entry records when it occurred, the actor (or 'System' for automated changes, with the name denormalized so it survives later renames), the entity type (Project, Task, Idea, User, Decision, Template, or Settings) and its label, the action, and a short summary such as 'Status: In Progress → Blocked'."),
  li("Actions include create, update, delete, status change, convert, invite, deactivate, activate, role change, and password reset."),
  li("Auditing is best-effort and never blocks the underlying operation, so read the log as a strong record of activity rather than a transactional guarantee."),
  ...proc(
    "How to: Find activity in the audit log",
    "Open Admin → \"Audit log\".",
    "Narrow the list with the \"Entity\" dropdown (All entities, Project, Task, Idea, User, Decision, Template, Settings), the \"Action\" dropdown, and the \"Actor\" dropdown (including \"System\").",
    "Type in the \"Search\" box to match on the entity name or summary. Click \"Refresh\" to reload, or \"Clear filters\" to reset. Results are newest-first.",
  ),

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
  li("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY — long-lived IAM-user credentials for AWS Bedrock, required when AI is enabled (Section 18)."),
  li("BEDROCK_REGION (and/or AWS_REGION) — the AWS region for Bedrock calls; defaults to us-east-1."),
  li("Seed/admin overrides (default admin email and name, seed-source path) and PPTX template path overrides exist for setup and customization."),
  h2("16.3 Supabase Auth Configuration"),
  li("In the Supabase dashboard, set the Site URL and the allowed redirect URLs to include the application's auth callback for both local and production hosts."),
  li("Customize the invite and recovery email templates to point at the application's auth callback route, passing the token as query parameters (this is what the interstitial in Section 2.4 relies on)."),
  h2("16.4 The Daily Cron"),
  li("A Vercel Cron entry calls the notification sweep endpoint daily at 07:00 UTC with the CRON_SECRET. The job is tuned to finish well within the platform's function time limit."),

  // ===================================================================
  h1("17. Operational Scripts"),
  p("A set of maintenance scripts is run from the server (not the application UI), typically by an operator with database credentials, via the project's package scripts. The most relevant to administrators:"),
  h2("17.1 Setup & Data"),
  li("Seed — build the initial data set and a default administrator."),
  li("Spreadsheet import — re-import ideas/projects from the source spreadsheet; supports a dry-run before applying."),
  li("Supabase / auth-user migration — one-time historical steps from the original migration to Supabase; retained for reference."),
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
  p("Praxis includes three optional AI features. All three are gated by the AI_ENABLED environment flag; when it is off, the feature buttons are hidden, the endpoints decline to run, and idea-overlap falls back to its keyword heuristic so it always returns something useful."),
  li("Complexity & time estimate — suggests a project's complexity and a rough time estimate from its description."),
  li("Priority recommendation — reasons across the open-project list and proposes a ranking, presented for review rather than applied automatically."),
  li("Idea overlap — compares a submitted idea against existing projects and ideas to surface likely duplicates (Section 7.2)."),
  ...proc(
    "How to: Generate an AI complexity & time estimate for a project",
    "Open a project's create or edit form (AI must be enabled, and you need create/edit permission).",
    "Below the description, click \"Generate AI estimate\" (or \"Regenerate AI estimate\"). A description of at least ~20 characters is required.",
    "The suggested complexity and time estimate appear in an \"AI suggestion\" banner and fill the form's fields; they persist when you save the project.",
  ),
  ...proc(
    "How to: Run an AI priority review",
    "On the Projects page, click \"AI priority review\" (visible when AI is enabled and you can create projects).",
    "In the \"AI Priority Review\" panel, click \"Run review\".",
    "Read the recommended ranking and per-project rationale. The output is advisory — nothing is applied automatically; click a project to open it and adjust manually. Use \"Re-run review\" to refresh.",
  ),
  h2("18.1 Models and Credentials"),
  li("Each feature's model is chosen by an administrator on the Admin → Configuration → AI tab (Section 14.1), from the live list of models the account can invoke. By convention the high-volume estimate uses a fast, economical model and the reasoning-heavy features use a stronger one."),
  li("The features call AWS Bedrock using long-lived IAM-user access keys. This replaced an earlier approach based on interactive SSO sign-in, which could not refresh in the hosting environment; the IAM-user keys do not expire and so work in production once provided."),
  li("Region policies matter: some Bedrock 'inference profiles' route across regions and can be blocked by an organization's region-whitelist policy. The model picker labels each option with its routing scope so you can choose one that stays within allowed regions."),
  li("Whether AI is actually active in a given deployment depends on AI_ENABLED and the presence of valid AWS credentials. Treat enabling AI as a deliberate decision (cost and data-handling), and confirm the chosen models are reachable from your region before relying on them."),

  // ===================================================================
  h1("Appendix A: Permission Catalog"),
  p("The complete set of permissions, by category. The default note marks which non-Admin roles receive each by default (PL = Project Lead, TM = Team Member, V = Viewer); Admin always has all of them."),
  h2("Projects"),
  li("View projects — see the project list, detail pages, and quick views. Default: PL, TM, V."),
  li("Create projects — add new projects. Default: PL."),
  li("Edit projects — update fields on existing projects. Default: PL."),
  li("Delete projects — permanently remove projects (cancellation is a status, not a delete). Default: Admin only."),
  h2("Tasks"),
  li("View tasks — see the tasks page and task detail panels. Default: PL, TM, V."),
  li("Create tasks — add tasks under a project. Default: PL, TM."),
  li("Edit tasks — update task status, assignees, due dates, and other fields. Default: PL, TM."),
  li("Delete tasks — permanently remove tasks. Default: PL."),
  li("Move tasks between projects — reassign a task to a different project. Default: PL."),
  h2("Ideas"),
  li("Review submitted ideas — open the queue and approve, reject, or comment. Default: PL."),
  li("Convert ideas to projects — promote an approved idea into a project. Default: PL."),
  h2("Roadmap"),
  li("View the roadmap — open the Timeline, Kanban, Portfolio, and Now/Next/Later views. Default: PL, TM, V."),
  li("Export roadmap to PPTX — generate the PowerPoint deck. Default: PL."),
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
  li("View audit log — open the Admin → Audit log page. Default: Admin only."),

  // ===================================================================
  h1("Appendix B: Status, Phase & Priority Reference"),
  h2("Project Status (built-in)"),
  p("Not Started, In Planning, In Progress, Blocked, On Hold, Delayed, Completed, Canceled. Extensible by administrators; each custom status carries 'is open' and 'is terminal' flags."),
  h2("Project Phase (built-in)"),
  p("Qualification, Prioritization, Planning, Data Modeling, Application Development, Customer Validation, Deployment Readiness, Handover, Closeout. Extensible by administrators; ordering preserved by an order value."),
  h2("Priority (built-in)"),
  p("Critical, High, Medium, Low. Extensible by administrators; each custom priority carries a rank."),
  h2("Task Status (fixed)"),
  p("Not Started, Awaiting Dependency, In Progress, Blocked, Delayed, On Hold, Complete, Canceled. NOT extensible — these statuses are relied upon by the auto-unblock cascade and the health score."),

  // ===================================================================
  h1("Appendix C: Page & Navigation Inventory"),
  h2("Everyday Pages"),
  li("Home — at-a-glance summary and recent activity."),
  li("Projects — the project list and detail/quick-view panels."),
  li("Tasks and My tasks — all tasks, and the current user's tasks."),
  li("Roadmap — Timeline, Kanban, Portfolio, Now/Next/Later (one page, four views)."),
  li("Insights — Velocity dashboard, Resources, Key capabilities, and Ideas review."),
  li("Profile → Notifications — per-user notification preferences."),
  li("Submit — the public idea-submission portal (no sign-in)."),
  h2("Admin Pages"),
  li("Configuration — Custom fields, Project values, Portfolio quadrants, Health thresholds, AI."),
  li("Resource management — Users, Roles & permissions, Resource thresholds."),
  li("Templates, Notifications, and Audit log."),
  h2("Auth Pages"),
  li("Login, Forgot password, Reset password, and the invite-acceptance flow."),
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
