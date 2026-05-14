/**
 * Sign-in page.
 *
 * If a user with a valid session lands here (e.g. they bookmarked
 * `/login`), bounce them directly to the destination. Otherwise render
 * the credentials form, which is a client component because it owns
 * `useState` for inline error rendering.
 *
 * NextAuth's credentials handler uses query-string error reporting:
 * failed sign-ins redirect to `/login?error=CredentialsSignin`. The
 * client form picks that up and shows a generic message — by design,
 * we don't tell the caller whether it was the email or the password
 * that was wrong.
 */

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "@/components/login-form";
import { PublicChrome } from "@/components/polaris/PublicChrome";

// Calls `auth()` to redirect-if-already-signed-in; that reads
// cookies, so the page is per-request and must not be pre-rendered
// at build time.
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
    invited?: string;
    reset?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  const { callbackUrl, error, invited, reset } = await searchParams;
  const safeCallback = sanitizeCallback(callbackUrl);

  if (session?.user) {
    redirect(safeCallback);
  }

  return (
    <PublicChrome width="narrow">
      <div style={{ marginBottom: 20 }}>
        <p className="page-eyebrow">Sign in</p>
        <h1 className="page-title" style={{ marginTop: 6 }}>
          Welcome back.
        </h1>
        <p className="page-subtitle" style={{ marginTop: 8, lineHeight: 1.55 }}>
          Use the email and password issued to you by an administrator.
        </p>
      </div>

      {invited ? (
        <div
          role="status"
          className="pol-notice pol-notice-ok"
          style={{ marginBottom: 16 }}
        >
          <span aria-hidden="true">✓</span>
          <span>Password set. Sign in below to finish.</span>
        </div>
      ) : null}

      {reset ? (
        <div
          role="status"
          className="pol-notice pol-notice-ok"
          style={{ marginBottom: 16 }}
        >
          <span aria-hidden="true">✓</span>
          <span>
            Password updated. Sign in below with your new password.
          </span>
        </div>
      ) : null}

      <div className="pol-card pol-card-pad">
        <LoginForm callbackUrl={safeCallback} initialError={error ?? null} />
      </div>
    </PublicChrome>
  );
}

/**
 * Reject open-redirect attempts. NextAuth itself rejects callbacks to
 * other origins, but defense-in-depth: anything that isn't a same-origin
 * absolute path falls back to `/`.
 */
function sanitizeCallback(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}
