/**
 * Styled 403 / Forbidden page (ADM-15).
 *
 * Reached when `requirePermission` throws `ForbiddenError` on a
 * server-rendered page. The auth helper catches the throw and
 * redirects here so the user sees an in-shell, branded explanation
 * rather than Next.js's default error overlay.
 *
 * The page is intentionally minimal: a heading, a short explanation,
 * and a link back to Home. We don't surface the missing permission
 * key — that's an internal detail and could leak the access-control
 * structure. If a user genuinely needs access, the admin's the one
 * to grant it.
 */

import Link from "next/link";

import { auth } from "@/auth";
import { getCurrentUserPermissions } from "@/lib/auth/permissions";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage() {
  const session = await auth();
  // If the user isn't signed in at all, the upstream UnauthorizedError
  // path runs first and redirects to sign-in — we won't usually land
  // here without a session. But render a sensible fallback anyway so
  // the page never crashes.
  if (!session?.user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-bold text-gray-900">
          Access denied
        </h1>
        <p className="mt-3 text-sm text-gray-700">
          You don&apos;t have permission to view this page.{" "}
          <Link href="/sign-in" className="text-blue-700 underline">
            Sign in
          </Link>{" "}
          with an account that does, or contact an administrator.
        </p>
      </main>
    );
  }

  const { permissions } = await getCurrentUserPermissions();

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="home"
      breadcrumbs={[{ label: "Access denied" }]}
    >
      <PolarisPageHeader
        eyebrow="403"
        title="Access denied"
        subtitle="Your role doesn't grant the permission needed for that page."
      />
      <div className="pol-card">
        <div className="pol-card-pad space-y-3 text-sm text-gray-700">
          <p>
            Your account is signed in, but the role assigned to it
            (<span className="font-semibold">{session.user.role}</span>)
            doesn&apos;t include the permission required to view that
            page.
          </p>
          <p>
            If you think this is wrong, ask an administrator to update
            the role-to-permission mapping in{" "}
            <span className="font-mono text-xs">
              Admin → Resource management → Roles &amp; permissions
            </span>
            .
          </p>
          <p>
            <Link
              href="/"
              className="pol-btn pol-btn-primary"
            >
              ← Back to Home
            </Link>
          </p>
        </div>
      </div>
    </PolarisShell>
  );
}
