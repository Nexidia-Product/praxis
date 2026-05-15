/**
 * Home page — first landing after sign-in.
 *
 * Renders inside the Polaris shell. Shows a small dashboard tailored to
 * what the signed-in user can actually do:
 *
 *   - Four KPI tiles (open projects, open tasks, my tasks, ideas in queue)
 *   - "Quick access" — links to the major work surfaces, shown only
 *     when the user's permissions cover that area
 *   - Portfolio signals — at-a-glance health
 *   - Public submissions card — always visible (the /submit portal is public)
 *   - Administration card — every admin tile gated by its specific
 *     permission key, so a Project Lead who's been granted, say,
 *     "manage templates" sees that one tile and not the others
 *
 * Server component: pulls counts from the repositories on render. The
 * counts are intentionally cheap — `Array.length` after a `getAll()`
 * — since the JSON store loads the whole file regardless.
 */

import Link from "next/link";

import { auth } from "@/auth";
import { getCurrentUserPermissions } from "@/lib/auth/permissions";
import {
  IdeaRepository,
  ProjectRepository,
  TaskRepository,
} from "@/lib/db";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import { OPEN_PROJECT_STATUSES } from "@/lib/projects/service";
import { isActiveStatus, isAssignedToUser } from "@/lib/tasks/display";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // The middleware guarantees a session reached this server component, so
  // `session` is non-null in practice. We still narrow the type so a
  // future change to the matcher can't accidentally crash the page.
  const session = await auth();
  const user = session?.user;

  if (!user) {
    // Should never happen — middleware redirects unauthenticated users.
    return null;
  }

  const { permissions } = await getCurrentUserPermissions();

  // Permission shortcuts. Avoid repeated map lookups in the render below
  // and document what each section needs. `can` rather than `has` because
  // it reads naturally inline ("if can review ideas, fetch them").
  const can = {
    viewProjects: permissions["projects.view"] === true,
    viewTasks: permissions["tasks.view"] === true,
    viewVelocity: permissions["velocity.view"] === true,
    viewRoadmap: permissions["roadmap.view"] === true,
    viewResources: permissions["resources.view"] === true,
    reviewIdeas: permissions["ideas.review"] === true,
    // Admin permission groups — mirror the four nav links under Admin.
    // Each group is "any of the per-tab permissions for the consolidated
    // page." A user with a single underlying permission still sees the
    // group link, and the destination page hides the tabs they can't access.
    manageResources:
      permissions["admin.users.manage"] === true ||
      permissions["admin.roles.manage"] === true ||
      permissions["admin.resource_thresholds.manage"] === true,
    manageConfiguration:
      permissions["admin.custom_fields.manage"] === true ||
      permissions["admin.project_values.manage"] === true ||
      permissions["admin.portfolio_quadrants.manage"] === true ||
      permissions["admin.health_thresholds.manage"] === true,
    manageTemplates: permissions["admin.templates.manage"] === true,
    manageNotifications: permissions["admin.notifications.run_sweep"] === true,
    viewAuditLog: permissions["admin.audit_log.view"] === true,
  };
  // Show the Administration card iff the user has any admin-flavored
  // permission. We don't hard-code a role check — that's the whole
  // point of the matrix. The four groups above cover every per-tab
  // admin permission that matters for the tile; "admin.console" alone
  // doesn't unlock any specific tile and is intentionally excluded.
  const hasAnyAdminTile =
    can.manageResources ||
    can.manageConfiguration ||
    can.manageTemplates ||
    can.manageNotifications ||
    can.viewAuditLog;

  // Fetch only what we'll display. Skip the ideas read for users
  // without `ideas.review` — they wouldn't see the result anyway and a
  // tiny saving still beats an unconditional read at scale.
  const [projects, tasks, ideas] = await Promise.all([
    can.viewProjects ? ProjectRepository.getAll() : Promise.resolve([]),
    can.viewTasks ? TaskRepository.getAll() : Promise.resolve([]),
    can.reviewIdeas ? IdeaRepository.getAll() : Promise.resolve([]),
  ]);

  const openProjects = projects.filter((p) =>
    OPEN_PROJECT_STATUSES.includes(p.status),
  ).length;
  // KPIs count anything still "on the table" — i.e. not Complete and
  // not Canceled. This is broader than the default Tasks page filter
  // (which excludes On Hold and Delayed) on purpose: a Delayed task IS
  // a task that needs your attention and should show up in your count.
  const openTasks = tasks.filter((t) => isActiveStatus(t.status)).length;
  // "My open tasks" must use the same name-or-id matching as the My
  // Tasks page (HOME-02). Legacy seed tasks store `responsible` as a
  // name; new ones store user_id. Without the name fallback every
  // legacy task is invisible to the KPI, even though the user can see
  // them on /my-tasks.
  const myOpenTasks = tasks.filter(
    (t) =>
      isAssignedToUser(t, user.user_id, user.name ?? "") &&
      isActiveStatus(t.status),
  ).length;
  const ideasOpen = ideas.filter(
    (i) => i.status === "New" || i.status === "Under Review",
  ).length;
  const blockedTasks = tasks.filter((t) => t.status === "Blocked").length;
  const redProjects = projects.filter((p) => p.health_score === "Red").length;

  return (
    <PolarisShell user={{ ...user, permissions }} navKey="home">
      <PolarisPageHeader
        eyebrow="Workspace"
        title={`Welcome${user.name ? `, ${user.name.split(/\s+/)[0]}` : ""}.`}
        subtitle="Projects, tasks, and roadmaps for your team."
      />

      {/* KPI tiles — each tile only shown if the user has the underlying
          permission to read what it counts. The fourth tile is dynamic:
          ideas if the user can review them, blocked tasks otherwise. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {can.viewProjects ? (
          <Kpi label="Open projects" value={openProjects} href="/projects" />
        ) : (
          <KpiPlaceholder />
        )}
        {can.viewTasks ? (
          <Kpi label="Open tasks" value={openTasks} href="/tasks" />
        ) : (
          <KpiPlaceholder />
        )}
        {can.viewTasks ? (
          <Kpi
            label="My open tasks"
            value={myOpenTasks}
            href="/my-tasks"
            accent={myOpenTasks > 0 ? "active" : undefined}
          />
        ) : (
          <KpiPlaceholder />
        )}
        {can.reviewIdeas ? (
          <Kpi
            label="Ideas in queue"
            value={ideasOpen}
            href="/admin/ideas"
            accent={ideasOpen > 0 ? "active" : undefined}
          />
        ) : can.viewTasks ? (
          <Kpi
            label="Blocked tasks"
            value={blockedTasks}
            accent={blockedTasks > 0 ? "warn" : undefined}
          />
        ) : (
          <KpiPlaceholder />
        )}
      </div>

      {/* Two-column: quick access + signals */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 12,
        }}
      >
        <div className="pol-card">
          <div className="pol-card-title">Quick access</div>
          <div className="pol-card-body" style={{ paddingTop: 4 }}>
            <NavList>
              {can.viewProjects ? (
                <NavRow
                  href="/projects"
                  title="Projects"
                  description="The full project repository — filter, sort, update status, create new initiatives."
                />
              ) : null}
              {can.viewTasks ? (
                <NavRow
                  href="/tasks"
                  title="Tasks"
                  description="Every task across the portfolio, color-coded by urgency, groupable by project / owner / status / priority."
                />
              ) : null}
              {can.viewTasks ? (
                <NavRow
                  href="/my-tasks"
                  title="My tasks"
                  description="Just the tasks assigned to you, blocked items first."
                />
              ) : null}
              {can.viewRoadmap ? (
                <NavRow
                  href="/roadmap"
                  title="Roadmap"
                  description="Four views over the same portfolio: Timeline, Kanban, Portfolio bubble chart, and Now / Next / Later."
                />
              ) : null}
              {can.viewVelocity ? (
                <NavRow
                  href="/dashboard/velocity"
                  title="Velocity"
                  description="Historical metrics — completion cadence, time-to-finish, throughput, and where projects get stuck."
                />
              ) : null}
              {can.viewResources ? (
                <NavRow
                  href="/insights/resources"
                  title="Resources"
                  description="Capacity and performance per team member — see who is over- or under-loaded across active projects."
                />
              ) : null}
              {can.reviewIdeas ? (
                <NavRow
                  href="/admin/ideas"
                  title="Ideas"
                  description="Review submissions from the public portal. Approve, reject, or convert to projects."
                />
              ) : null}
            </NavList>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Portfolio signals: only meaningful if the viewer can see
              the underlying data. Hide the whole card otherwise rather
              than showing zeros that look broken. */}
          {can.viewProjects || can.viewTasks ? (
            <div className="pol-card">
              <div className="pol-card-title">Portfolio signals</div>
              <div className="pol-card-body">
                {can.viewProjects ? (
                  <SignalRow
                    label="Projects at risk (Red)"
                    value={redProjects}
                    tone={redProjects > 0 ? "err" : "muted"}
                  />
                ) : null}
                {can.viewTasks ? (
                  <SignalRow
                    label="Blocked tasks"
                    value={blockedTasks}
                    tone={blockedTasks > 0 ? "warn" : "muted"}
                  />
                ) : null}
                {can.viewProjects ? (
                  <SignalRow
                    label="Active projects"
                    value={openProjects}
                    tone="ok"
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="pol-card">
            <div className="pol-card-title">Public submissions</div>
            <div className="pol-card-body">
              <p style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.5 }}>
                Anyone — including people without an account — can submit an
                innovation idea via the public portal.
              </p>
              <Link
                href="/submit"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 10,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                <span
                  className="mono"
                  style={{
                    background: "var(--bg)",
                    padding: "2px 6px",
                    borderRadius: 2,
                  }}
                >
                  /submit
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          {/* Administration card. Per-tile gating: a user with only
              one underlying admin permission sees only that group's
              link. A user with no admin permissions doesn't see the
              card at all. */}
          {hasAnyAdminTile ? (
            <div className="pol-card">
              <div className="pol-card-title">Administration</div>
              <div className="pol-card-body" style={{ paddingTop: 4 }}>
                {can.manageResources ? (
                  <AdminLink
                    href="/admin/resources"
                    label="Resource management"
                  />
                ) : null}
                {can.manageConfiguration ? (
                  <AdminLink
                    href="/admin/configuration"
                    label="Configuration"
                  />
                ) : null}
                {can.manageTemplates ? (
                  <AdminLink href="/admin/templates" label="Templates" />
                ) : null}
                {can.manageNotifications ? (
                  <AdminLink
                    href="/admin/notifications"
                    label="Notifications"
                  />
                ) : null}
                {can.viewAuditLog ? (
                  <AdminLink href="/admin/audit-log" label="Audit log" />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </PolarisShell>
  );
}

// ---------------------------------------------------------------------------
// Local primitives
// ---------------------------------------------------------------------------

function Kpi({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: number;
  href?: string;
  accent?: "active" | "warn";
}) {
  const accentColor =
    accent === "warn"
      ? "var(--err)"
      : accent === "active"
        ? "var(--brand)"
        : "var(--t1)";
  const className =
    accent === "active" ? "kpi-card is-active" : "kpi-card";
  const inner = (
    <div className={className}>
      <div className="kpi-value" style={{ color: accentColor }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
  if (!href) return inner;
  return (
    <Link
      href={href}
      className="hoverable-card"
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "block",
      }}
    >
      {inner}
    </Link>
  );
}

/**
 * Empty placeholder rendered when a KPI slot is gated off for the
 * current user. Keeps the four-column grid balanced rather than
 * collapsing the row to fewer tiles, which would shift the remaining
 * tiles around between users with different permissions.
 */
function KpiPlaceholder() {
  return (
    <div
      className="kpi-card"
      style={{ background: "transparent", border: "1px dashed var(--border)" }}
      aria-hidden="true"
    />
  );
}

function NavList({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

function NavRow({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="hoverable-row"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        padding: "10px 12px",
        margin: "0 -12px",
        borderBottom: "1px solid var(--border)",
        textDecoration: "none",
        color: "var(--t1)",
        gap: 16,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)" }}>
          {title}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 12,
            color: "var(--t2)",
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      </div>
      <div
        style={{
          color: "var(--brand)",
          fontSize: 14,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        →
      </div>
    </Link>
  );
}

function SignalRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "err" | "muted";
}) {
  const dotColor =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "err"
          ? "var(--err)"
          : "var(--tm)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--t2)",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dotColor,
          }}
          aria-hidden="true"
        />
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)" }}>
        {value}
      </div>
    </div>
  );
}

function AdminLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid var(--border)",
        fontSize: 12,
        color: "var(--t1)",
        textDecoration: "none",
      }}
    >
      <span style={{ color: "var(--t1)" }}>{label}</span>
      <span style={{ color: "var(--brand)" }}>→</span>
    </Link>
  );
}
