"use client";

/**
 * Interactive user management panel rendered inside the Users tab of
 * the Admin → Resource management page. Owns the in-memory list of
 * users and dispatches PATCH/POST calls to the admin API as the
 * operator clicks around.
 *
 * Four actions per user:
 *
 *   - Invite a user (top-of-panel form; on success appends the new
 *     user and surfaces the invite URL for the operator to copy).
 *   - Change a user's role (inline <select>; PATCHes immediately).
 *   - Activate / deactivate (inline button; PATCHes `active`).
 *   - Send password reset (inline button; POSTs to the reset endpoint
 *     and surfaces the resulting URL for the operator to share if
 *     email delivery isn't configured).
 *
 * No optimistic updates: the API call returns the canonical record and
 * we replace the local entry with it. Latency at team scale is small
 * enough that the simpler model is the right tradeoff.
 *
 * The current admin's own row blocks self-demote / self-deactivate at
 * the UI level (the API also enforces this; the UI guard is just so
 * the controls don't tease an action that will fail). Self-reset IS
 * permitted — sometimes admins want to rotate their own password.
 *
 * Styling: matches the Polaris design language defined in
 * `app/polaris.css`. Uses `pol-btn`, `pol-input`, `pol-select`,
 * `pol-tag`, `pol-card`, `col-header`, and `grid-row` per the brief.
 */

import { useState } from "react";
import type { AdminUser } from "@/lib/auth/admin-user-view";
import type { UserId, UserRole } from "@/lib/db";

const ROLE_OPTIONS: UserRole[] = [
  "Admin",
  "Project Lead",
  "Team Member",
  "Viewer",
];

interface UsersAdminPanelProps {
  initialUsers: AdminUser[];
  currentUserId: UserId;
}

interface ShareableLink {
  user_id: UserId;
  user_name: string;
  url: string;
  kind: "invite" | "reset";
  email_delivered?: boolean;
}

export function UsersAdminPanel({
  initialUsers,
  currentUserId,
}: UsersAdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [latestLink, setLatestLink] = useState<ShareableLink | null>(null);
  const [pendingResetId, setPendingResetId] = useState<UserId | null>(null);

  function applyUpdate(updated: AdminUser) {
    setUsers((prev) =>
      prev.map((u) => (u.user_id === updated.user_id ? updated : u)),
    );
  }

  async function changeRole(user: AdminUser, role: UserRole) {
    setError(null);
    const res = await fetch(`/api/admin/users/${user.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      user?: AdminUser;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "Could not change role.");
      return;
    }
    if (data.user) applyUpdate(data.user);
  }

  async function toggleActive(user: AdminUser) {
    setError(null);
    const res = await fetch(`/api/admin/users/${user.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      user?: AdminUser;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "Could not update status.");
      return;
    }
    if (data.user) applyUpdate(data.user);
  }

  async function sendPasswordReset(user: AdminUser) {
    setError(null);
    setPendingResetId(user.user_id);
    const res = await fetch(
      `/api/admin/users/${user.user_id}/reset-password`,
      { method: "POST" },
    );
    const data = (await res.json().catch(() => ({}))) as {
      user?: AdminUser;
      reset_url?: string;
      email_delivered?: boolean;
      error?: string;
    };
    setPendingResetId(null);
    if (!res.ok || !data.user || !data.reset_url) {
      setError(data.error ?? "Could not generate reset link.");
      return;
    }
    applyUpdate(data.user);
    setLatestLink({
      user_id: user.user_id,
      user_name: user.name,
      url: data.reset_url,
      kind: "reset",
      email_delivered: data.email_delivered,
    });
  }

  function handleInviteSent(
    user: AdminUser,
    inviteUrl: string | null,
    emailDelivered: boolean,
  ) {
    setUsers((prev) =>
      [...prev, user].sort((a, b) => a.name.localeCompare(b.name)),
    );
    // Only surface the share-link banner if we actually have a URL
    // to share. When the Supabase email is the only delivery
    // channel, no banner = no clutter.
    if (inviteUrl) {
      setLatestLink({
        user_id: user.user_id,
        user_name: user.name,
        url: inviteUrl,
        kind: "invite",
        email_delivered: emailDelivered,
      });
    }
    setInviteOpen(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <p style={{ fontSize: 12, color: "var(--t2)" }}>
          {users.length} user{users.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={() => {
            setInviteOpen((v) => !v);
            setError(null);
          }}
          className="pol-btn pol-btn-primary"
        >
          {inviteOpen ? "Cancel invite" : "Invite user"}
        </button>
      </div>

      {inviteOpen ? (
        <InviteUserForm onSent={handleInviteSent} onError={setError} />
      ) : null}

      {latestLink ? (
        <ShareableLinkBanner
          link={latestLink}
          onDismiss={() => setLatestLink(null)}
        />
      ) : null}

      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="pol-card" style={{ padding: 0 }}>
        <div
          className="col-header"
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 2fr 1fr 1fr 1.4fr",
            gap: 12,
            padding: "8px 14px",
          }}
        >
          <div>Name</div>
          <div>Email</div>
          <div>Role</div>
          <div>Status</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>

        {users.map((u) => {
          const isSelf = u.user_id === currentUserId;
          const isResetting = pendingResetId === u.user_id;
          return (
            <div
              key={u.user_id}
              className="grid-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 2fr 1fr 1fr 1.4fr",
                gap: 12,
                padding: "10px 14px",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  color: "var(--t1)",
                  fontSize: 12,
                }}
              >
                {u.name}
                {isSelf ? (
                  <span
                    className="pol-tag pol-tag-gray"
                    style={{ marginLeft: 6 }}
                  >
                    you
                  </span>
                ) : null}
              </div>
              <div style={{ color: "var(--t2)", fontSize: 12 }}>
                {u.email}
              </div>
              <div>
                <select
                  value={u.role}
                  disabled={isSelf}
                  onChange={(e) =>
                    changeRole(u, e.target.value as UserRole)
                  }
                  className="pol-select"
                  style={{ width: "100%" }}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <UserStatusTag user={u} />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => sendPasswordReset(u)}
                  disabled={!u.active || isResetting}
                  className="pol-btn pol-btn-secondary pol-btn-sm"
                  title={
                    u.active
                      ? "Generate a one-time password reset link"
                      : "Reactivate the account first"
                  }
                >
                  {isResetting ? "Sending…" : "Reset password"}
                </button>
                <button
                  type="button"
                  onClick={() => toggleActive(u)}
                  disabled={isSelf}
                  className="pol-btn pol-btn-ghost pol-btn-sm"
                >
                  {u.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          );
        })}

        {users.length === 0 ? (
          <div
            style={{
              padding: "32px 14px",
              textAlign: "center",
              color: "var(--tm)",
              fontSize: 12,
            }}
          >
            No users yet. Invite someone to get started.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status tag
// ---------------------------------------------------------------------------

function UserStatusTag({ user }: { user: AdminUser }) {
  if (!user.active) {
    return <span className="pol-tag pol-tag-gray">Deactivated</span>;
  }
  if (user.pending_password_reset) {
    return <span className="pol-tag pol-tag-yellow">Reset pending</span>;
  }
  if (user.pending_invite) {
    return <span className="pol-tag pol-tag-yellow">Invited</span>;
  }
  return <span className="pol-tag pol-tag-green">Active</span>;
}

// ---------------------------------------------------------------------------
// Invite sub-form
// ---------------------------------------------------------------------------

interface InviteUserFormProps {
  onSent: (
    user: AdminUser,
    inviteUrl: string | null,
    emailDelivered: boolean,
  ) => void;
  onError: (message: string) => void;
}

function InviteUserForm({ onSent, onError }: InviteUserFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("Team Member");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      user?: AdminUser;
      invite_url?: string | null;
      email_delivered?: boolean;
      error?: string;
    };
    setSubmitting(false);

    // Success = the API returned a 2xx and a user record. The
    // shareable invite_url is a bonus that the API may not produce
    // (Supabase rate limits, etc.) — its absence shouldn't fail the
    // invite from the UI's perspective when the Supabase invite
    // email itself was sent successfully.
    if (!res.ok || !data.user) {
      onError(data.error ?? "Could not send invite.");
      return;
    }

    setName("");
    setEmail("");
    setRole("Team Member");
    onSent(data.user, data.invite_url ?? null, data.email_delivered === true);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="pol-card pol-card-pad"
      style={{ background: "var(--bg)" }}
    >
      <div className="section-label" style={{ marginBottom: 10 }}>
        Invite new user
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 160px",
          gap: 10,
          alignItems: "end",
        }}
      >
        <div className="form-field">
          <label htmlFor="invite-name" className="form-label">
            Name
          </label>
          <input
            id="invite-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            className="pol-input"
          />
        </div>
        <div className="form-field">
          <label htmlFor="invite-email" className="form-label">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="pol-input"
          />
        </div>
        <div className="form-field">
          <label htmlFor="invite-role" className="form-label">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={submitting}
            className="pol-select"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: 12,
        }}
      >
        <button
          type="submit"
          disabled={submitting || !name || !email}
          className="pol-btn pol-btn-primary"
        >
          {submitting ? "Sending…" : "Send invite"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shareable link banner — shown after invite or password reset
// ---------------------------------------------------------------------------

interface ShareableLinkBannerProps {
  link: ShareableLink;
  onDismiss: () => void;
}

function ShareableLinkBanner({ link, onDismiss }: ShareableLinkBannerProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail in some environments; URL is visible
      // in the readonly input below for manual selection.
    }
  }

  const headline =
    link.kind === "invite"
      ? link.email_delivered
        ? "Invite emailed"
        : "Invite created"
      : link.email_delivered
        ? "Reset link emailed"
        : "Reset link generated";

  const detail =
    link.kind === "invite"
      ? link.email_delivered
        ? `We emailed an invite to ${link.user_name}. The link below also works — share it directly if needed. It expires in 14 days.`
        : `Email delivery isn't configured (or it failed). Share this link with ${link.user_name} directly. It expires in 14 days.`
      : link.email_delivered
        ? `We emailed a reset link to ${link.user_name}. The link below also works — you can share it directly if needed. It expires in 1 hour.`
        : `Email delivery isn't configured (or it failed). Share this link with ${link.user_name} directly. It expires in 1 hour.`;

  const variant =
    link.email_delivered === false
      ? "pol-notice pol-notice-warn"
      : "pol-notice pol-notice-ok";

  return (
    <div className={variant}>
      <span aria-hidden="true">
        {link.email_delivered === false ? "!" : "✓"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{headline}</div>
        <div style={{ marginTop: 2, fontSize: 12 }}>{detail}</div>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <input
            readOnly
            value={link.url}
            onFocus={(e) => e.currentTarget.select()}
            className="pol-input"
            style={{
              flex: 1,
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontSize: 11,
            }}
          />
          <button
            type="button"
            onClick={copy}
            className="pol-btn pol-btn-secondary pol-btn-sm"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="pol-btn pol-btn-ghost pol-btn-sm"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
