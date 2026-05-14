/**
 * Compatibility shim for `import { auth } from "@/auth"`.
 *
 * Pre-Stage 2 this file initialized NextAuth and exported its `auth`,
 * `handlers`, `signIn`, and `signOut` helpers. Stage 2 hands identity
 * off to Supabase Auth — there's no NextAuth instance anymore — but
 * many server components still write
 *
 *     import { auth } from "@/auth";
 *
 * to read the current session. We keep that import path stable by
 * aliasing `auth` to `getSession()` from the new permissions module.
 * The returned shape matches what the NextAuth callback used to
 * produce (`{ user: { user_id, name, email, role } } | null`), so no
 * call site needed editing.
 *
 * The other former exports (`handlers`, `signIn`, `signOut`) are gone
 * — there is no `/api/auth/[...nextauth]` route in the Supabase
 * world. Browser code that needs to sign in or out goes through
 * `lib/supabase/client.ts → getBrowserClient().auth.signInWithPassword`
 * and friends.
 */

export { getSession as auth } from "@/lib/auth/permissions";
