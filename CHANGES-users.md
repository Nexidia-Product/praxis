# Users functionality changes

Two features land together:

1. **Password reset flow** for users who've forgotten their password.
2. **Editable role permissions matrix** in the Admin Console.

---

## 1. Password reset

### User-facing entry points

- **`/forgot-password`** — public page. User enters their email, gets a generic "if an account exists, we sent a link" confirmation. Same response shape whether or not the email matches a real account (anti-enumeration).
- **`/reset-password/<token>`** — public page consuming a one-time token. Validates the token at render and on submission, surfaces a "set new password" form mirroring the invite-accept flow, redirects to `/login?reset=1` on success.
- **"Forgot password?" link** added to the login form, below the password field.
- **Admin-triggered reset** — new "Reset password" button on each row in `/admin/users`. Generates a fresh token and:
  - sends an email if `RESEND_API_KEY` is set, **and**
  - always returns the URL to the admin so they can share it out-of-band when email isn't available (the most common reason an admin uses this path).

### Tokens

- Stored on the User record: `password_reset_token` + `password_reset_token_expires_at`.
- TTL: **1 hour** (vs. 14 days for invite tokens — short because reset is a higher-risk operation).
- Cleared when the password is set, even if the user also had a pending invite (accepting a reset effectively also accepts the invite — they end up with a working password).
- Existing users.json files survive the schema addition: a `backfill()` helper applied to every read defaults the new fields to `null` if missing.

### Anti-enumeration

- Public reset request: always returns generic `200 OK`, same wall-clock latency on the "real user" and "no such user" paths.
- Public reset confirm: same generic error message for "unknown token", "expired token", or "deactivated user". Password-validation errors are only surfaced after the token is known good (so an attacker can't use the validation message as an oracle).
- Rate limit: 5 requests / IP / hour on the public request endpoint, via the existing in-memory limiter.
- Admin reset: explicit 404 for unknown user IDs (admin already knows the user exists, so no point shrouding).

### Dev mode

If `NODE_ENV !== "production"` and `RESEND_API_KEY` isn't set, the public reset-request response includes a `dev_only_reset_url` field so a tester can complete the flow without configuring email. Production responses never include this field.

---

## 2. Roles & permissions matrix

### Where to find it

- **Admin → Roles & permissions** — new nav item under the Admin section.
- **Path:** `/admin/role-permissions`
- **Required permission:** `admin.roles.manage` (granted by default only to Admin, but the matrix could grant it to other roles).

### How it works

A two-axis matrix:
- **Rows:** the permission catalog, grouped by category (Projects / Tasks / Ideas / Roadmap / Insights / Administration).
- **Columns:** the four roles (Admin / Project Lead / Team Member / Viewer).

Click a checkbox to toggle, then "Save changes" to persist. The Admin column is **locked** — Admin always has every permission, by design, so there's always a path back from any change made here.

Other UI affordances:
- "Reset to defaults" — loads the seeded defaults into the local state (still requires Save to persist).
- "Discard changes" — reverts to the last-saved state without a server round-trip.
- A soft warning surfaces if any non-Admin role has admin.* permissions but lacks `admin.console` (those routes would be unreachable from the nav).

### Architecture

- **Catalog (`lib/auth/role-permissions.ts`):** the canonical list of permission keys + metadata + default per-role grants. Adding or removing permission keys is a code change because it implies adding or removing gates in the application.
- **Mapping (`settings.json → role_permissions`):** the runtime, configurable role → permission grants. Edited from the Admin Console matrix.
- **Gates (`lib/auth/permissions.ts`):** new sibling to `requireRole(...)`:
  - `requirePermission(key)` for API routes / pages.
  - `hasPermission(key)` for UI conditionals.
  - `getCurrentUserPermissions()` for bulk-resolving the full map for a server component (used to feed the Shell's nav-filter).
- **Normalization on read:** `normalizeRolePermissions()` in the catalog file repairs any malformed or out-of-date `settings.json` shape — unknown keys dropped, missing roles get the default, Admin always becomes the full set.

### Migration

The Users API (`/api/admin/users`, `/api/admin/users/[id]`) and the `/admin/users` page have been switched from `requireRole("Admin")` to `requirePermission("admin.users.manage")`. Default behavior is unchanged (only Admin has it by default), but now an Admin can grant user management to a Project Lead from the matrix.

The Polaris Shell nav has been updated similarly: each admin item declares a `permission` key, and the parent server page passes the live permissions map via the `user.permissions` prop. Pages that don't yet pass a permissions map fall back to "Admin sees everything" behavior — so the existing admin pages (custom-fields, templates, health-thresholds, ideas) still work as before. Migrating them to `requirePermission()` is straightforward when desired.

---

## Files changed

### New
- `lib/auth/role-permissions.ts` — catalog, defaults, normalizer
- `lib/auth/reset-email.ts` — Resend integration with dev-mode fallback
- `app/forgot-password/page.tsx`
- `app/reset-password/[token]/page.tsx`
- `app/admin/role-permissions/page.tsx`
- `app/api/public/password-reset/request/route.ts`
- `app/api/public/password-reset/confirm/route.ts`
- `app/api/admin/users/[id]/reset-password/route.ts`
- `app/api/admin/role-permissions/route.ts`
- `components/forgot-password-form.tsx`
- `components/reset-password-form.tsx`
- `components/admin/role-permissions-editor.tsx`

### Modified
- `lib/auth/permissions.ts` — added `requirePermission` / `hasPermission` / `getCurrentUserPermissions` / `getPermissionsForRole`
- `lib/auth/admin-user-view.ts` — added `pending_password_reset` flag
- `lib/db/types.ts` — added password-reset fields on User; added `RolePermissionsMap` and `role_permissions` on AppSettings
- `lib/db/users.ts` — added `getByPasswordResetToken`; `backfill()` for old records; defaults in `create()`; relaxed `CreateUserInput`
- `lib/db/settings.ts` — seeded `role_permissions` defaults
- `scripts/seed.ts` — initialize the new password-reset fields on the seeded admin
- `app/api/admin/users/route.ts` — `requirePermission("admin.users.manage")`
- `app/api/admin/users/[id]/route.ts` — `requirePermission("admin.users.manage")`
- `app/admin/users/page.tsx` — `requirePermission`, passes permissions to Shell
- `app/login/page.tsx` — handles `?reset=1` flash banner
- `components/login-form.tsx` — added "Forgot password?" link
- `components/users-admin-panel.tsx` — full rewrite in Polaris styling, "Reset password" action, unified link banner for invites + resets, new status tag with "Reset pending"
- `components/polaris/Shell.tsx` — `permission` field on nav items, accepts `user.permissions`, "Roles & permissions" entry added
- `middleware.ts` — `/forgot-password` and `/reset-password/` added to the public allow-list

### Verified
- `npx tsc --noEmit` runs clean.
