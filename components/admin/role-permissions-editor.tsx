"use client";

/**
 * Role → permissions matrix editor.
 *
 * Renders the catalog grouped by category with one row per permission,
 * and one checkbox column per editable role. Admin is shown but its
 * column is non-interactive (and visually faded) — Admin always has
 * everything, by design.
 *
 * Edits are local until "Save changes" is clicked, then sent as one
 * PUT to the server. There's also a "Reset to defaults" button that
 * loads the seeded defaults into the local state (still requires Save
 * to persist).
 *
 * Behavior notes:
 *
 *   - Toggling a row toggles a single (role, permission) cell. Whole-
 *     row "grant to all" / "revoke from all" buttons are intentionally
 *     omitted — accidental toggle of a category-wide row would be
 *     more dangerous than helpful.
 *   - The "admin.console" permission is needed for the Admin section
 *     to show up in the nav at all. Granting any other "admin.*"
 *     permission without "admin.console" would produce dead routes;
 *     we surface a soft warning when that happens but don't enforce
 *     it (an organization may legitimately want users with API access
 *     but no UI access).
 *   - Dirty state ("you have unsaved changes") is tracked by deep
 *     equality against `initialMatrix`. We don't try to merge concurrent
 *     edits — last-write-wins per the JSON-store design.
 */

import { useMemo, useState } from "react";
import type {
  PermissionCategory,
  PermissionDefinition,
  PermissionKey,
} from "@/lib/auth/role-permissions";
import type { UserRole } from "@/lib/db";

interface RolePermissionsEditorProps {
  catalog: ReadonlyArray<PermissionDefinition>;
  catalogByCategory: Array<{
    category: PermissionCategory;
    permissions: PermissionDefinition[];
  }>;
  allKeys: PermissionKey[];
  editableRoles: UserRole[];
  initialMatrix: Record<UserRole, PermissionKey[]>;
  defaults: Record<UserRole, PermissionKey[]>;
}

const ALL_ROLES: UserRole[] = [
  "Admin",
  "Project Lead",
  "Team Member",
  "Viewer",
];

export function RolePermissionsEditor({
  catalogByCategory,
  allKeys,
  editableRoles,
  initialMatrix,
  defaults,
}: RolePermissionsEditorProps) {
  const [matrix, setMatrix] = useState<Record<UserRole, Set<PermissionKey>>>(
    () => toSets(initialMatrix),
  );
  const [savedMatrix, setSavedMatrix] = useState<
    Record<UserRole, Set<PermissionKey>>
  >(() => toSets(initialMatrix));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * Whether the in-app "confirm reset?" modal is open (ADM-06). The
   * previous implementation used `globalThis.confirm`, which renders the
   * browser's built-in dialog and clashes with the application UI.
   */
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const dirty = useMemo(
    () => !setsEqual(matrix, savedMatrix, allKeys, editableRoles),
    [matrix, savedMatrix, allKeys, editableRoles],
  );

  const consoleWarnings = useMemo(
    () => collectConsoleWarnings(matrix, editableRoles),
    [matrix, editableRoles],
  );

  function toggle(role: UserRole, key: PermissionKey) {
    if (role === "Admin") return; // Admin is immutable.
    setMatrix((prev) => {
      const next = { ...prev };
      const set = new Set(prev[role]);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[role] = set;
      return next;
    });
    setError(null);
    setSavedAt(null);
  }

  function resetToDefaults() {
    // Open the in-app confirmation modal (ADM-06). The actual reset
    // happens in `confirmResetToDefaults` once the user confirms.
    setResetConfirmOpen(true);
  }

  function confirmResetToDefaults() {
    setMatrix(toSets(defaults));
    setError(null);
    setSavedAt(null);
    setResetConfirmOpen(false);
  }

  function discardChanges() {
    setMatrix(toSets(toArrays(savedMatrix, allKeys)));
    setError(null);
    setSavedAt(null);
  }

  async function save() {
    if (!dirty || submitting) return;
    setSubmitting(true);
    setError(null);

    const payload = toArrays(matrix, allKeys);
    const res = await fetch("/api/admin/role-permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role_permissions: payload }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(data.error ?? "Could not save permissions.");
      return;
    }
    const data = (await res.json()) as {
      role_permissions: Record<UserRole, PermissionKey[]>;
    };
    setMatrix(toSets(data.role_permissions));
    setSavedMatrix(toSets(data.role_permissions));
    setSavedAt(Date.now());
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="pol-notice pol-notice-info">
        <span aria-hidden="true">ℹ</span>
        <span>
          The <strong>Admin</strong> role always has every permission and
          can&apos;t be edited from this matrix. That guarantees there&apos;s
          always a path to undo changes made here.
        </span>
      </div>

      {consoleWarnings.length > 0 ? (
        <div className="pol-notice pol-notice-warn">
          <span aria-hidden="true">!</span>
          <div>
            <div style={{ fontWeight: 600 }}>Heads up:</div>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {consoleWarnings.map((w) => (
                <li key={w} style={{ fontSize: 12 }}>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      {savedAt ? (
        <div role="status" className="pol-notice pol-notice-ok">
          <span aria-hidden="true">✓</span>
          <span>Permissions saved.</span>
        </div>
      ) : null}

      <div className="pol-card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Sticky header row with role columns. */}
        <div
          className="col-header"
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplate(),
            gap: 12,
            padding: "10px 14px",
            position: "sticky",
            top: 0,
            background: "var(--card)",
            zIndex: 1,
          }}
        >
          <div>Permission</div>
          {ALL_ROLES.map((role) => (
            <div
              key={role}
              style={{
                textAlign: "center",
                color:
                  role === "Admin"
                    ? "var(--tm)"
                    : "var(--tm)",
              }}
            >
              {role}
              {role === "Admin" ? (
                <span
                  style={{
                    display: "block",
                    fontSize: 9,
                    fontWeight: 500,
                    letterSpacing: 0.4,
                    color: "var(--tm)",
                    marginTop: 2,
                  }}
                >
                  (locked)
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {catalogByCategory.map((group) => (
          <div key={group.category}>
            <div
              style={{
                padding: "10px 14px 6px",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--brand)",
                background: "var(--bg)",
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {group.category}
            </div>
            {group.permissions.map((perm) => (
              <div
                key={perm.key}
                className="grid-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate(),
                  gap: 12,
                  padding: "10px 14px",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--t1)",
                    }}
                  >
                    {perm.label}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--tm)",
                      marginTop: 2,
                      lineHeight: 1.45,
                    }}
                  >
                    {perm.description}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--tm)",
                      marginTop: 4,
                      fontFamily:
                        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    }}
                  >
                    {perm.key}
                  </div>
                </div>
                {ALL_ROLES.map((role) => {
                  const checked =
                    role === "Admin" ? true : matrix[role].has(perm.key);
                  const disabled =
                    role === "Admin" || !editableRoles.includes(role);
                  return (
                    <div
                      key={role}
                      style={{
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 22,
                          height: 22,
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: role === "Admin" ? 0.55 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(role, perm.key)}
                          aria-label={`${role} – ${perm.label}`}
                          style={{ width: 14, height: 14, cursor: "inherit" }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          paddingTop: 4,
        }}
      >
        <button
          type="button"
          onClick={resetToDefaults}
          className="pol-btn pol-btn-ghost"
          disabled={submitting}
        >
          Reset to defaults
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={discardChanges}
            className="pol-btn pol-btn-secondary"
            disabled={!dirty || submitting}
          >
            Discard changes
          </button>
          <button
            type="button"
            onClick={save}
            className="pol-btn pol-btn-primary"
            disabled={!dirty || submitting}
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
      {resetConfirmOpen ? (
        <ResetConfirmModal
          dirty={dirty}
          onCancel={() => setResetConfirmOpen(false)}
          onConfirm={confirmResetToDefaults}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reset confirmation modal (ADM-06)
// ---------------------------------------------------------------------------

interface ResetConfirmModalProps {
  /** Whether the user has unsaved changes — affects the warning copy. */
  dirty: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * In-app confirmation modal for "Reset to defaults" (ADM-06). Replaces
 * the previous native `confirm()` dialog so the message style matches
 * the rest of the application UI.
 */
function ResetConfirmModal({
  dirty,
  onCancel,
  onConfirm,
}: ResetConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-confirm-title"
      onClick={(e) => {
        // Click-outside dismisses, matching the export modal and the
        // timeline target-date confirm modal.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2
            id="reset-confirm-title"
            className="text-base font-semibold tracking-tight text-gray-900"
          >
            Reset role permissions to defaults?
          </h2>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm text-gray-700">
          <p>
            Every non-Admin role will be returned to its seeded default set
            of permissions. This affects what users in those roles can see
            and do.
          </p>
          {dirty ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You have unsaved changes — they will be discarded.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Reset only updates the editor; nothing is saved until you
              click <span className="font-medium">Save changes</span>.
            </p>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="pol-btn pol-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="pol-btn pol-btn-primary"
          >
            Reset
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gridTemplate(): string {
  // Permission column wide; one column per role.
  return "minmax(0,1fr) repeat(4, 100px)";
}

function toSets(
  m: Record<UserRole, PermissionKey[]>,
): Record<UserRole, Set<PermissionKey>> {
  return {
    Admin: new Set(m.Admin),
    "Project Lead": new Set(m["Project Lead"]),
    "Team Member": new Set(m["Team Member"]),
    Viewer: new Set(m.Viewer),
  };
}

function toArrays(
  m: Record<UserRole, Set<PermissionKey>>,
  allKeys: PermissionKey[],
): Record<UserRole, PermissionKey[]> {
  // Iterate `allKeys` so the persisted order is deterministic and matches
  // the catalog rather than insertion order.
  return {
    Admin: allKeys.filter((k) => m.Admin.has(k)),
    "Project Lead": allKeys.filter((k) => m["Project Lead"].has(k)),
    "Team Member": allKeys.filter((k) => m["Team Member"].has(k)),
    Viewer: allKeys.filter((k) => m.Viewer.has(k)),
  };
}

function setsEqual(
  a: Record<UserRole, Set<PermissionKey>>,
  b: Record<UserRole, Set<PermissionKey>>,
  allKeys: PermissionKey[],
  editableRoles: UserRole[],
): boolean {
  // Only compare roles we actually let the user edit; Admin is always
  // the full catalog.
  for (const role of editableRoles) {
    if (a[role].size !== b[role].size) return false;
    for (const k of allKeys) {
      if (a[role].has(k) !== b[role].has(k)) return false;
    }
  }
  return true;
}

function collectConsoleWarnings(
  matrix: Record<UserRole, Set<PermissionKey>>,
  editableRoles: UserRole[],
): string[] {
  const warnings: string[] = [];
  for (const role of editableRoles) {
    const grants = matrix[role];
    const hasAnyAdminPerm = [...grants].some(
      (k) => k.startsWith("admin.") && k !== "admin.console",
    );
    if (hasAnyAdminPerm && !grants.has("admin.console")) {
      warnings.push(
        `${role} has admin permissions but not "admin.console" — those admin pages won't appear in the nav for them.`,
      );
    }
  }
  return warnings;
}
