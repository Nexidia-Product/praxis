"use client";

/**
 * Notification bell rendered in every signed-in page's header (Section
 * 5.12). Owns:
 *
 *   - polling the unread count on mount and on a 60s interval
 *   - opening a drawer of the most recent notifications on click
 *   - per-row "mark read" via POST `/api/notifications/[id]/read`
 *   - a "mark all read" action via PATCH `/api/notifications`
 *
 * Why polling and not a WebSocket? At team scale the polling interval
 * (60s) is fine, the implementation is one fetch and a setInterval,
 * and we don't need a long-lived connection wrapper. Switching to push
 * later would replace the `useEffect` body without touching the rest
 * of the component.
 *
 * The drawer renders inside a portal-less absolute container — it is
 * positioned relative to the bell so it never escapes the nav bar.
 * Clicking outside closes it. ESC closes it. The bell itself is
 * keyboard-focusable; tab order is preserved.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { Notification, NotificationEntityType } from "@/lib/db";

interface NotificationApiResponse {
  notifications: Notification[];
  unread_count: number;
  total: number;
}

const POLL_INTERVAL_MS = 60_000;
const DRAWER_LIMIT = 25;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // -------- Data fetching ---------------------------------------------------

  const fetchSummary = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/notifications?limit=${DRAWER_LIMIT}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const data = (await r.json()) as NotificationApiResponse;
      setUnreadCount(data.unread_count);
      // Only update the list when the drawer is open or empty — when the
      // drawer is closed, we don't want a background poll to overwrite an
      // optimistic mark-read the user just performed.
      setNotifications((prev) => {
        if (prev.length === 0 || open) return data.notifications;
        return prev;
      });
    } catch {
      // Silent — the bell is non-critical chrome and shouldn't surface
      // a network blip the user can't act on.
    }
  }, [open]);

  // First fetch + polling.
  useEffect(() => {
    void fetchSummary();
    const handle = setInterval(() => {
      void fetchSummary();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [fetchSummary]);

  // Refresh the list when the drawer opens so it's accurate.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch(
          `/api/notifications?limit=${DRAWER_LIMIT}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          setError("Could not load notifications.");
          return;
        }
        const data = (await r.json()) as NotificationApiResponse;
        setNotifications(data.notifications);
        setUnreadCount(data.unread_count);
      } catch {
        setError("Could not load notifications.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  // -------- Outside-click / Escape close -----------------------------------

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // -------- Actions --------------------------------------------------------

  async function markRead(notification: Notification) {
    if (notification.read) return;
    // Optimistic update.
    setNotifications((prev) =>
      prev.map((n) =>
        n.notification_id === notification.notification_id
          ? { ...n, read: true }
          : n,
      ),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      const r = await fetch(
        `/api/notifications/${encodeURIComponent(notification.notification_id)}/read`,
        { method: "POST" },
      );
      if (!r.ok) await fetchSummary(); // roll back via re-read
    } catch {
      await fetchSummary();
    }
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    // Optimistic.
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      const r = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all_read: true }),
      });
      if (!r.ok) await fetchSummary();
    } catch {
      await fetchSummary();
    }
  }

  // -------- Render ---------------------------------------------------------

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "var(--pol-radius)",
          background: open ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.12)",
          border: "1px solid rgba(255,255,255,.25)",
          color: "#fff",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "rgba(255,255,255,.22)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "rgba(255,255,255,.12)";
        }}
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 8,
              background: "var(--err)",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              lineHeight: "16px",
              textAlign: "center",
              display: "inline-block",
            }}
            aria-hidden="true"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 30,
            width: 360,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--pol-radius)",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--border)",
              padding: "10px 14px",
            }}
          >
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "var(--t1)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Notifications
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button
                type="button"
                onClick={markAllRead}
                disabled={unreadCount === 0}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 11,
                  fontWeight: 600,
                  color: unreadCount === 0 ? "var(--tm)" : "var(--brand)",
                  cursor: unreadCount === 0 ? "not-allowed" : "pointer",
                  padding: 0,
                }}
              >
                Mark all read
              </button>
              <Link
                href="/profile/notifications"
                onClick={() => setOpen(false)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--t2)",
                  textDecoration: "none",
                }}
              >
                Settings
              </Link>
            </div>
          </div>

          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {loading && notifications.length === 0 ? (
              <p
                style={{
                  padding: "16px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--tm)",
                }}
              >
                Loading…
              </p>
            ) : error ? (
              <p
                style={{
                  padding: "16px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--err)",
                }}
              >
                {error}
              </p>
            ) : notifications.length === 0 ? (
              <p
                style={{
                  padding: "20px 16px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--tm)",
                }}
              >
                You&rsquo;re all caught up.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {notifications.map((n) => (
                  <NotificationRow
                    key={n.notification_id}
                    notification={n}
                    onActivate={() => {
                      void markRead(n);
                      setOpen(false);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function NotificationRow({
  notification,
  onActivate,
}: {
  notification: Notification;
  onActivate: () => void;
}) {
  const href = entityHref(notification.entity_type, notification.entity_id);
  const baseStyle: React.CSSProperties = {
    display: "block",
    cursor: "pointer",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    background: notification.read ? "var(--card)" : "var(--selected)",
    color: "var(--t1)",
    textDecoration: "none",
    width: "100%",
    textAlign: "left",
    border: "none",
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    fontFamily: "inherit",
  };
  const inner = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span
        style={{
          marginTop: 6,
          width: 6,
          height: 6,
          flexShrink: 0,
          borderRadius: "50%",
          background: notification.read ? "transparent" : "var(--brand)",
        }}
        aria-hidden="true"
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: "var(--t1)",
            margin: 0,
          }}
        >
          {notification.message}
        </p>
        <p
          style={{
            marginTop: 3,
            fontSize: 10,
            color: "var(--tm)",
          }}
        >
          {formatRelativeTime(notification.created_at)}
        </p>
      </div>
    </div>
  );
  return (
    <li style={{ listStyle: "none" }}>
      {href ? (
        <Link
          href={href}
          onClick={onActivate}
          style={baseStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = notification.read
              ? "var(--card)"
              : "var(--selected)";
          }}
        >
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onActivate}
          style={baseStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = notification.read
              ? "var(--card)"
              : "var(--selected)";
          }}
        >
          {inner}
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityHref(type: NotificationEntityType, id: string): string | null {
  if (type === "Project") return `/projects?id=${encodeURIComponent(id)}`;
  if (type === "Task") return `/tasks?id=${encodeURIComponent(id)}`;
  if (type === "Idea") return `/admin/ideas/${encodeURIComponent(id)}`;
  return null;
}

/**
 * Compact relative time string: "just now", "5m", "3h", "2d", "Apr 14".
 * Not localized — matches the rest of the app's plain-English copy.
 */
function formatRelativeTime(isoTimestamp: string): string {
  const then = Date.parse(isoTimestamp);
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  // Older — render a calendar date.
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 14, height: 14 }}
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
