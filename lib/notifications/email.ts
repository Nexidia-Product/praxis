/**
 * Email transport for the notification system (Section 5.12).
 *
 * Three responsibilities:
 *
 *   1. **Resend transport.** Wraps the Resend HTTP API. Initialized
 *      lazily on the first send so a missing `RESEND_API_KEY` doesn't
 *      crash the app on startup — instead the service logs the email
 *      payload to stdout and returns success. That lets the rest of the
 *      pipeline run end-to-end in development without real outbound mail.
 *
 *   2. **Templates.** One template per `NotificationType`. Subject + plain
 *      text + minimal HTML, all rendered server-side. We avoid pulling in
 *      a full template engine — the messages are short and a tagged
 *      template literal is more legible than MJML for this scale.
 *
 *   3. **Digest dispatch.** A separate `dispatchDigestEmail` for the
 *      daily roll-up so the scheduler can call us with N pending
 *      notifications and one email goes out instead of N.
 *
 * What this file does NOT do:
 *
 *   - Decide whether to send. That's `lib/notifications/service.ts` —
 *     this module trusts the caller and just dispatches what it's told.
 *   - Persist anything. The in-app row is written by the service before
 *     the email fires; if the email blows up, the in-app feed still works.
 */

import type { Notification, NotificationType } from "@/lib/db";

// ---------------------------------------------------------------------------
// Resend client (lazy)
// ---------------------------------------------------------------------------

type ResendClient = {
  emails: {
    send: (args: {
      from: string;
      to: string | string[];
      subject: string;
      text: string;
      html: string;
    }) => Promise<unknown>;
  };
};

let cachedClient: ResendClient | null = null;
let cachedClientKey: string | null = null;

/**
 * Lazily build the Resend client. We re-build if the API key changes
 * between calls (test runs that mutate process.env mid-run); otherwise
 * we hold one instance for the process lifetime.
 *
 * Returns `null` when no key is configured — the caller falls back to
 * console-logging the would-be email.
 */
async function getResendClient(): Promise<ResendClient | null> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (cachedClient && cachedClientKey === key) return cachedClient;
  // Dynamic import: keeps `resend` out of the build graph for serverless
  // bundles that disable email entirely. The package is small but every
  // skipped module helps cold-start times.
  //
  // /* webpackIgnore: true */ stops Next.js's bundler from walking into
  // resend at build time — it pulls in Node-only built-ins (stream,
  // crypto) that webpack cannot resolve for the Edge runtime. The
  // package is loaded by Node at runtime through the normal require
  // chain.
  const resendModule = (await import(
    /* webpackIgnore: true */ "resend"
  )) as typeof import("resend");
  cachedClient = new resendModule.Resend(key) as unknown as ResendClient;
  cachedClientKey = key;
  return cachedClient;
}

function resolveFromAddress(): string {
  return (
    process.env.RESEND_FROM?.trim() ||
    "Praxis <onboarding@resend.dev>"
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Look up subject + body text for one notification. The message body the
 * caller already built (via `lib/notifications/service.ts`) is the
 * canonical user-facing string; the template wraps it with a subject and
 * a couple of UI niceties.
 */
function renderNotificationEmail(
  recipientName: string,
  notification: Pick<Notification, "type" | "message" | "entity_type" | "entity_id">,
): RenderedEmail {
  const subject = subjectForType(notification.type, notification.message);
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const body = notification.message;
  const footer = entityFooter(notification.entity_type, notification.entity_id);
  const text = [greeting, "", body, "", footer, "", "— Praxis"].join("\n");
  const html = htmlEmailLayout({
    title: subject,
    greeting,
    body,
    footer,
  });
  return { subject, text, html };
}

function subjectForType(type: NotificationType, message: string): string {
  // Subjects are short tags so the user can triage their inbox at a
  // glance; the body carries the detail.
  switch (type) {
    case "TaskAssigned":
      return "[Praxis] Task assigned to you";
    case "TaskDueSoon":
      return "[Praxis] Task due soon";
    case "TaskOverdue":
      return "[Praxis] Task overdue";
    case "ProjectBlocked":
      return "[Praxis] Project blocked";
    case "DependencyBlocked":
      return "[Praxis] Upstream dependency blocked";
    case "HealthScoreChanged":
      return "[Praxis] Project health changed";
    case "IdeaStatusChanged":
      return "[Praxis] Update on your submitted idea";
    default: {
      // Compile-time exhaustiveness; runtime fallback uses the message.
      const _exhaustive: never = type;
      void _exhaustive;
      return `[Praxis] ${message.slice(0, 60)}`;
    }
  }
}

function entityFooter(entityType: Notification["entity_type"], entityId: string): string {
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "";
  switch (entityType) {
    case "Project":
      return base
        ? `View the project: ${base}/projects?id=${encodeURIComponent(entityId)}`
        : `Project ID: ${entityId}`;
    case "Task":
      return base
        ? `View the task: ${base}/tasks?id=${encodeURIComponent(entityId)}`
        : `Task ID: ${entityId}`;
    case "Idea":
      // Submitters don't have a logged-in surface to send them to.
      return `Reference: ${entityId}`;
  }
}

/**
 * Minimal, copy-paste-safe HTML email skeleton. Inline styles only —
 * Gmail and Outlook strip <style> blocks. No external assets. Designed
 * to read fine in plain text too.
 */
function htmlEmailLayout(opts: {
  title: string;
  greeting: string;
  body: string;
  footer: string;
}): string {
  const escape = (s: string): string =>
    s.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
    );
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escape(opts.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="background-color:#f9fafb;padding:24px 0;">
      <tr>
        <td>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="560" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <p style="margin:0 0 12px 0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:600;">Praxis</p>
                <h1 style="margin:0;font-size:18px;font-weight:600;color:#111827;line-height:1.4;">${escape(opts.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 20px 28px;">
                <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#374151;">${escape(opts.greeting)}</p>
                <p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#374151;">${escape(opts.body)}</p>
                <p style="margin:0 0 0 0;font-size:13px;line-height:1.55;color:#6b7280;">${escape(opts.footer)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 22px 28px;border-top:1px solid #f3f4f6;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">You can adjust which notifications come to email in your Praxis profile.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

// ---------------------------------------------------------------------------
// Public dispatchers
// ---------------------------------------------------------------------------

/**
 * Send a single per-event notification email. The notification record's
 * `message` is used as the body; the template adds subject, greeting,
 * and a deep-link footer.
 *
 * Returns `{ delivered: true }` if Resend accepted the request, or
 * `{ delivered: false, reason: "no-key" | "..." }` when we logged
 * instead of sending. Never throws — failures are logged.
 */
export async function dispatchNotificationEmail(opts: {
  to: string;
  recipientName: string;
  notification: Pick<Notification, "type" | "message" | "entity_type" | "entity_id" | "notification_id" | "user_id" | "read" | "created_at">;
}): Promise<{ delivered: boolean; reason?: string }> {
  const rendered = renderNotificationEmail(opts.recipientName, opts.notification);
  return sendEmail({
    to: opts.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

/**
 * Send the daily digest for one user — one email summarizing every
 * notification accumulated since the last digest. Rendered as a single
 * email rather than per-notification.
 */
export async function dispatchDigestEmail(opts: {
  to: string;
  recipientName: string;
  notifications: Notification[];
}): Promise<{ delivered: boolean; reason?: string }> {
  if (opts.notifications.length === 0) {
    return { delivered: false, reason: "empty" };
  }
  const subject = `[Praxis] Daily summary — ${opts.notifications.length} update${opts.notifications.length === 1 ? "" : "s"}`;
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : "Hi,";
  const intro =
    opts.notifications.length === 1
      ? "Here is the update accumulated since your last digest:"
      : `Here are the ${opts.notifications.length} updates accumulated since your last digest:`;

  const lines = opts.notifications.map(
    (n) => `• ${labelForType(n.type)} — ${n.message}`,
  );
  const text = [greeting, "", intro, "", ...lines, "", "— Praxis"].join("\n");
  const html = digestHtmlLayout({
    greeting,
    intro,
    items: opts.notifications.map((n) => ({
      label: labelForType(n.type),
      message: n.message,
    })),
  });
  return sendEmail({ to: opts.to, subject, text, html });
}

function labelForType(type: NotificationType): string {
  const map: Record<NotificationType, string> = {
    TaskAssigned: "Task assigned",
    TaskDueSoon: "Task due soon",
    TaskOverdue: "Task overdue",
    ProjectBlocked: "Project blocked",
    DependencyBlocked: "Dependency blocked",
    HealthScoreChanged: "Health score change",
    IdeaStatusChanged: "Idea update",
  };
  return map[type];
}

function digestHtmlLayout(opts: {
  greeting: string;
  intro: string;
  items: Array<{ label: string; message: string }>;
}): string {
  const escape = (s: string): string =>
    s.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
    );
  const rows = opts.items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">
            <p style="margin:0 0 2px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;font-weight:600;">${escape(item.label)}</p>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#111827;">${escape(item.message)}</p>
          </td>
        </tr>`,
    )
    .join("");
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Praxis daily summary</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="background-color:#f9fafb;padding:24px 0;">
      <tr>
        <td>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="560" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <p style="margin:0 0 12px 0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:600;">Praxis</p>
                <h1 style="margin:0;font-size:18px;font-weight:600;color:#111827;line-height:1.4;">Daily summary</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 12px 28px;">
                <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#374151;">${escape(opts.greeting)}</p>
                <p style="margin:0 0 4px 0;font-size:14px;line-height:1.55;color:#374151;">${escape(opts.intro)}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:8px;">
                  ${rows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 22px 28px;border-top:1px solid #f3f4f6;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">You're receiving this because digest mode is enabled in your Praxis profile. Switch to per-event delivery in the profile to get real-time emails instead.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

// ---------------------------------------------------------------------------
// Low-level send
// ---------------------------------------------------------------------------

async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ delivered: boolean; reason?: string }> {
  const client = await getResendClient();
  if (!client) {
    // No key configured. Log and report. Useful for dev so the operator
    // can see exactly what would have gone out.
    console.info(
      `[notifications] (RESEND_API_KEY unset) would send email to ${opts.to}: ${opts.subject}`,
    );
    return { delivered: false, reason: "no-key" };
  }
  try {
    await client.emails.send({
      from: resolveFromAddress(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { delivered: true };
  } catch (err) {
    console.warn(
      `[notifications] resend send failed for ${opts.to}:`,
      err,
    );
    return { delivered: false, reason: "send-error" };
  }
}
