"use client";

/**
 * Polaris application shell.
 *
 * The single chrome around every authenticated page. Mirrors the NICE
 * NIA / QC Shell.tsx referenced in the canonical brief
 * (NIA_Polaris_Vibe_Coding_Master_4.md §3, §5):
 *
 *   - 40px branded header bar
 *   - 220px / 52px collapsible left rail with grouped sections
 *   - 28px breadcrumb strip
 *   - optional 36px tab strip
 *   - scrollable content area on the page background
 *
 * Pages call <PolarisShell> with the active nav key, breadcrumb trail,
 * and (optionally) tab definitions. They render their actual content
 * as children. The shell handles rail collapse, the brand bar, the
 * notification bell, and the sign-out menu.
 *
 * Client component because the rail's collapse state lives in
 * useState. Authentication-dependent props (user, role, unread count)
 * arrive resolved from the server via PolarisShellProps.
 */

import Link from "next/link";
import { useState } from "react";

import { NotificationBell } from "@/components/notifications/bell";
import { GlobalSearch } from "@/components/polaris/global-search";
import { UserMenu } from "@/components/polaris/user-menu";

// ---------------------------------------------------------------------------
// Nav structure
// ---------------------------------------------------------------------------

export type NavKey =
  | "home"
  | "projects"
  | "tasks"
  | "my-tasks"
  | "roadmap"
  | "groups"
  | "velocity"
  | "resources"
  | "ideas"
  | "admin-resources"
  | "admin-configuration"
  | "admin-templates"
  | "admin-notifications"
  | "admin-audit-log"
  | "profile-notifications";

interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  icon: string;
  /**
   * Roles allowed to see the link. `null`/undefined = visible to anyone
   * signed in. Used for the simple workspace items (Home, Projects, etc.)
   * where role-based visibility is fine.
   *
   * Prefer `permission` for new items: it consults the live
   * `role_permissions` map so an Admin can re-assign visibility from the
   * Roles & permissions matrix without a code change.
   */
  roles?: ReadonlyArray<"Admin" | "Project Lead" | "Team Member" | "Viewer">;
  /** Permission key required to see this item (overrides `roles`). */
  permission?: string;
  /**
   * "Any of these permissions" — used by grouped admin pages whose
   * tabs are gated by several different permissions. The link is
   * visible if the user has *any* one of them; the destination page
   * then hides individual tabs the user can't access. Mutually
   * exclusive with `permission` (set one or the other; if both are
   * set, `permissionsAny` wins because it's strictly more permissive).
   */
  permissionsAny?: readonly string[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { key: "home", label: "Home", href: "/", icon: "⌂" },
      { key: "projects", label: "Projects", href: "/projects", icon: "▦" },
      { key: "tasks", label: "Tasks", href: "/tasks", icon: "☰" },
      { key: "my-tasks", label: "My tasks", href: "/my-tasks", icon: "✓" },
      { key: "roadmap", label: "Roadmap", href: "/roadmap", icon: "▤" },
      { key: "groups", label: "Groups", href: "/groups", icon: "◖" },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        key: "velocity",
        label: "Velocity",
        href: "/dashboard/velocity",
        icon: "◷",
        permission: "velocity.view",
      },
      {
        key: "resources",
        label: "Resources",
        href: "/insights/resources",
        icon: "◍",
        permission: "resources.view",
      },
      {
        key: "ideas",
        label: "Ideas",
        href: "/admin/ideas",
        icon: "✶",
        permission: "ideas.review",
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        key: "admin-resources",
        label: "Resource management",
        href: "/admin/resources",
        icon: "◎",
        permissionsAny: [
          "admin.users.manage",
          "admin.roles.manage",
          "admin.resource_thresholds.manage",
        ],
      },
      {
        key: "admin-configuration",
        label: "Configuration",
        href: "/admin/configuration",
        icon: "⚙",
        permissionsAny: [
          "admin.custom_fields.manage",
          "admin.project_values.manage",
          "admin.portfolio_quadrants.manage",
          "admin.health_thresholds.manage",
        ],
      },
      {
        key: "admin-templates",
        label: "Templates",
        href: "/admin/templates",
        icon: "❐",
        permission: "admin.templates.manage",
      },
      {
        key: "admin-notifications",
        label: "Notifications",
        href: "/admin/notifications",
        icon: "✉",
        permission: "admin.notifications.run_sweep",
      },
      {
        key: "admin-audit-log",
        label: "Audit log",
        href: "/admin/audit-log",
        icon: "⌕",
        permission: "admin.audit_log.view",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PolarisTab {
  label: string;
  href: string;
  active?: boolean;
}

export interface PolarisShellProps {
  /** Authenticated user info (already resolved server-side). */
  user: {
    name?: string | null;
    email?: string | null;
    role: "Admin" | "Project Lead" | "Team Member" | "Viewer";
    /**
     * Live permission map keyed by `PermissionKey`. Optional for
     * backwards compatibility — pages that don't pass it fall back to
     * role-based visibility (Admin sees everything). New pages should
     * populate it from `getCurrentUserPermissions()` so the nav
     * reflects the live role-permissions matrix without a code change.
     */
    permissions?: Record<string, boolean>;
  };
  /** Which nav item to render as active. */
  navKey: NavKey;
  /** Breadcrumb items, root → leaf. The shell prepends "Praxis" automatically. */
  breadcrumbs?: BreadcrumbItem[];
  /** Optional tab strip shown directly below the breadcrumb. */
  tabs?: PolarisTab[];
  /** Page header content rendered inside the content area at the top. */
  pageHeader?: React.ReactNode;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function PolarisShell({
  user,
  navKey,
  breadcrumbs,
  tabs,
  pageHeader,
  children,
}: PolarisShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Filter nav items per section. Each item is shown if:
  //   - it has a `permissionsAny` field and the user has *at least one* of
  //     those permissions, OR
  //   - it has a `permission` field and the user has that permission, OR
  //   - it has a `roles` field and the user's role is allowed, OR
  //   - it has neither (i.e. visible to anyone signed in).
  // When `permission` is set we ignore `roles` — `permission` is the
  // newer model and gives the Roles & permissions matrix authority.
  // Fallback: if the parent didn't pass a permissions map, an Admin
  // sees every permission-gated item (so existing callers don't break),
  // and non-Admins see none of them. Pages should pass permissions to
  // get accurate filtering for non-Admin roles.
  const permissions = user.permissions;
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.permissionsAny && item.permissionsAny.length > 0) {
        if (permissions) {
          return item.permissionsAny.some((p) => permissions[p] === true);
        }
        return user.role === "Admin";
      }
      if (item.permission) {
        if (permissions) return permissions[item.permission] === true;
        return user.role === "Admin";
      }
      if (item.roles) return item.roles.includes(user.role);
      return true;
    }),
  })).filter((s) => s.items.length > 0);

  const railWidth = collapsed ? "var(--rail-collapsed)" : "var(--rail-w)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* Skip-to-content link — focus-only; keyboard users land on this
          first, hit Enter, and jump past the rail/header into the main
          content area. Hidden from sighted users via off-screen
          positioning that comes back into view on :focus. */}
      <a
        href="#main-content"
        className="skip-link"
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          padding: "6px 12px",
          background: "var(--brand)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: "var(--pol-radius)",
          textDecoration: "none",
          zIndex: 1000,
          transform: "translateY(-200%)",
          transition: "transform 0.1s",
        }}
      >
        Skip to main content
      </a>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header
        style={{
          height: "var(--header-h)",
          background: "var(--header)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          flexShrink: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0.5,
              textDecoration: "none",
            }}
          >
            <span
              style={{
                background: "rgba(255,255,255,.15)",
                border: "1px solid rgba(255,255,255,.25)",
                borderRadius: 2,
                padding: "1px 6px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              PRAXIS
            </span>
            <span>Praxis</span>
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <GlobalSearch />
          <NotificationBell />
          <UserMenu user={user} />
        </div>
      </header>

      {/* ── Body (rail + main) ─────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* ── Left rail ───────────────────────────────────────── */}
        <nav
          aria-label="Primary"
          style={{
            width: railWidth,
            background: "var(--card)",
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            transition: "width 0.2s ease",
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "8px 14px",
              borderBottom: "1px solid var(--border)",
              background: "transparent",
              border: "none",
              borderBottomColor: "var(--border)",
              borderBottomStyle: "solid",
              borderBottomWidth: 1,
              color: "var(--tm)",
              cursor: "pointer",
              width: "100%",
            }}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>
              {collapsed ? "›" : "‹"}
            </span>
          </button>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {sections.map((section) => (
              <div key={section.label}>
                {!collapsed ? (
                  <div
                    className="section-label"
                    style={{
                      padding: "12px 14px 4px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {section.label}
                  </div>
                ) : (
                  <div style={{ height: 12 }} aria-hidden="true" />
                )}
                {section.items.map((item) => {
                  const active = item.key === navKey;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: collapsed ? "7px 0" : "7px 14px",
                        justifyContent: collapsed ? "center" : "flex-start",
                        color: active ? "var(--brand)" : "var(--t2)",
                        background: active ? "var(--selected)" : "transparent",
                        borderLeft: active
                          ? "2px solid var(--brand)"
                          : "2px solid transparent",
                        fontSize: 12,
                        fontWeight: active ? 700 : 500,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                      }}
                      data-rail-item="true"
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 16,
                          textAlign: "center",
                          flexShrink: 0,
                          color: active ? "var(--brand)" : "var(--tm)",
                          fontSize: 13,
                        }}
                      >
                        {item.icon}
                      </span>
                      {!collapsed ? <span>{item.label}</span> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        {/* ── Main area ──────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Breadcrumb strip */}
          <div
            style={{
              height: "var(--breadcrumb-h)",
              background: "var(--card)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              gap: 6,
              fontSize: "var(--fs-xs)",
              color: "var(--tm)",
              flexShrink: 0,
            }}
          >
            <Link
              href="/"
              style={{
                color: "var(--brand)",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Praxis
            </Link>
            {(breadcrumbs ?? []).map((crumb, i) => (
              <span
                key={`${crumb.label}-${i}`}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <span style={{ color: "var(--border)" }}>›</span>
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    style={{
                      color: "var(--brand)",
                      textDecoration: "none",
                    }}
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span style={{ color: "var(--t2)" }}>{crumb.label}</span>
                )}
              </span>
            ))}
          </div>

          {/* Optional tab strip */}
          {tabs && tabs.length > 0 ? (
            <div
              style={{
                height: "var(--tab-h)",
                background: "var(--card)",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "flex-end",
                padding: "0 16px",
                gap: 0,
                flexShrink: 0,
              }}
            >
              {tabs.map((tab) => (
                <Link
                  key={tab.href}
                  href={tab.href}
                  style={{
                    padding: "0 14px",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: tab.active ? "var(--brand)" : "var(--tm)",
                    borderBottom: tab.active
                      ? "3px solid var(--brand)"
                      : "3px solid transparent",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    transition: "color 0.1s",
                  }}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          ) : null}

          {/* Content area */}
          <main
            id="main-content"
            tabIndex={-1}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px",
              background: "var(--bg)",
              outline: "none",
            }}
          >
            {pageHeader ? (
              <div style={{ marginBottom: 12 }}>{pageHeader}</div>
            ) : null}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page header — a small helper for the standard page-title block that
// usually goes inside the content area, before the toolbar / table.
// ---------------------------------------------------------------------------

export interface PolarisPageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PolarisPageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: PolarisPageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        paddingBottom: 12,
        marginBottom: 12,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div>
        {eyebrow ? <div className="page-eyebrow">{eyebrow}</div> : null}
        <h1
          className="page-title"
          style={{ marginTop: eyebrow ? 4 : 0 }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
