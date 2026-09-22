/**
 * Admin user mutations.
 *
 *   PATCH /api/admin/users/[id]   Update role / active flag.
 *
 * Identity is owned by Supabase Auth; we update the application
 * profile (`public.users`) and, for `active = false`, also ban the
 * user in Supabase Auth so existing sessions are revoked.
 *
 * No DELETE endpoint exists. Deactivation is the standard removal
 * flow — hard delete would orphan every `created_by`, `responsible`,
 * `project_lead`, etc. that references the user.
 *
 * Self-protection: the acting admin cannot demote or deactivate
 * themselves. Another admin must do that.
 */

import { NextResponse } from "next/server";

import { buildLastSignInIndex, toAdminUser } from "@/lib/auth/admin-user-view";
import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { UserRepository, type UserRole } from "@/lib/db";
import { audit } from "@/lib/audit/service";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getEnumOptions } from "@/lib/projects/enum-options";

const VALID_ROLES: UserRole[] = [
  "Admin",
  "Project Lead",
  "Team Member",
  "Viewer",
];

interface PatchBody {
  role?: unknown;
  active?: unknown;
  allowed_programs?: unknown;
  primary_program?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** ~100 years — Supabase's recommended "indefinite ban" value. */
const INDEFINITE_BAN = "876000h";

export const PATCH = withAuth(
  async (request: Request, context: RouteContext) => {
    const session = await requirePermission("admin.users.manage");
    const { id } = await context.params;

    let body: PatchBody;
    try {
      body = (await request.json()) as PatchBody;
    } catch {
      return NextResponse.json(
        { error: "Request body must be JSON." },
        { status: 400 },
      );
    }

    const target = await UserRepository.getById(id);
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const patch: {
      role?: UserRole;
      active?: boolean;
      allowed_programs?: string[] | null;
      primary_program?: string | null;
    } = {};

    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role as UserRole)) {
        return NextResponse.json({ error: "Invalid role." }, { status: 400 });
      }
      if (target.user_id === session.user.user_id && body.role !== "Admin") {
        return NextResponse.json(
          {
            error:
              "You cannot change your own role. Ask another Admin to do it.",
          },
          { status: 400 },
        );
      }
      patch.role = body.role as UserRole;
    }

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return NextResponse.json(
          { error: "`active` must be a boolean." },
          { status: 400 },
        );
      }
      if (target.user_id === session.user.user_id && body.active === false) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account." },
          { status: 400 },
        );
      }
      patch.active = body.active;
    }

    // Both program fields are validated against the merged program option
    // list (system + admin extensions), same source the Project form's
    // Program select uses — an admin can't restrict a user to a value
    // that doesn't actually exist.
    let validProgramIds: Set<string> | null = null;
    async function loadValidProgramIds(): Promise<Set<string>> {
      if (!validProgramIds) {
        const options = await getEnumOptions("program", true);
        validProgramIds = new Set(options.map((o) => o.id));
      }
      return validProgramIds;
    }

    if (body.allowed_programs !== undefined) {
      if (body.allowed_programs === null) {
        patch.allowed_programs = null;
      } else {
        if (
          !Array.isArray(body.allowed_programs) ||
          body.allowed_programs.length === 0 ||
          !body.allowed_programs.every((v) => typeof v === "string")
        ) {
          return NextResponse.json(
            {
              error:
                "`allowed_programs` must be null (unrestricted) or a non-empty array of program ids.",
            },
            { status: 400 },
          );
        }
        const validIds = await loadValidProgramIds();
        const ids = body.allowed_programs as string[];
        for (const id of ids) {
          if (!validIds.has(id)) {
            return NextResponse.json(
              { error: `Unknown program: ${id}.` },
              { status: 400 },
            );
          }
        }
        patch.allowed_programs = ids;
      }
    }

    if (body.primary_program !== undefined) {
      if (body.primary_program === null) {
        patch.primary_program = null;
      } else {
        if (typeof body.primary_program !== "string") {
          return NextResponse.json(
            { error: "`primary_program` must be a string or null." },
            { status: 400 },
          );
        }
        const validIds = await loadValidProgramIds();
        if (!validIds.has(body.primary_program)) {
          return NextResponse.json(
            { error: `Unknown program: ${body.primary_program}.` },
            { status: 400 },
          );
        }
        // Must be within the *effective* allowed set: the new value from
        // this same request if it's changing allowed_programs, else the
        // target's existing value.
        const effectiveAllowed =
          patch.allowed_programs !== undefined
            ? patch.allowed_programs
            : target.allowed_programs;
        if (
          effectiveAllowed !== null &&
          !effectiveAllowed.includes(body.primary_program)
        ) {
          return NextResponse.json(
            {
              error:
                "`primary_program` must be one of this user's allowed programs.",
            },
            { status: 400 },
          );
        }
        patch.primary_program = body.primary_program;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No supported fields in request body." },
        { status: 400 },
      );
    }

    // 1. Update the application profile.
    const updated = await UserRepository.update(id, patch);

    // 2. If the active flag changed, mirror it onto Supabase Auth so
    //    the existing session (if any) is revoked immediately rather
    //    than waiting for our session helper to refuse the next read.
    if (patch.active !== undefined) {
      const supabase = getServiceRoleClient();
      const { error: authErr } = await supabase.auth.admin.updateUserById(id, {
        ban_duration: patch.active ? "none" : INDEFINITE_BAN,
      });
      if (authErr) {
        // The profile flip already happened. Surface the secondary
        // failure but don't undo the profile change — better to have
        // both layers eventually consistent than to leave a half-set
        // state.
        console.warn(
          `[admin/users] Profile flipped to active=${patch.active} but Supabase ban update failed:`,
          authErr.message,
        );
      }
    }

    // Audit each touched dimension separately so the audit page can
    // filter on transitions.
    if (patch.role !== undefined && patch.role !== target.role) {
      await audit({
        actorId: session.user.user_id,
        actorName: session.user.name ?? null,
        entityType: "User",
        entityId: id,
        entityLabel: updated.name,
        action: "role_change",
        summary: `Role: ${target.role} → ${updated.role}`,
      });
    }
    if (patch.active !== undefined && patch.active !== target.active) {
      await audit({
        actorId: session.user.user_id,
        actorName: session.user.name ?? null,
        entityType: "User",
        entityId: id,
        entityLabel: updated.name,
        action: patch.active ? "activate" : "deactivate",
        summary: patch.active
          ? `Reactivated ${updated.email}.`
          : `Deactivated ${updated.email}.`,
      });
    }
    if (
      (patch.allowed_programs !== undefined &&
        JSON.stringify(patch.allowed_programs) !==
          JSON.stringify(target.allowed_programs)) ||
      (patch.primary_program !== undefined &&
        patch.primary_program !== target.primary_program)
    ) {
      const describe = (v: string[] | null) =>
        v === null ? "All programs" : v.join(", ");
      await audit({
        actorId: session.user.user_id,
        actorName: session.user.name ?? null,
        entityType: "User",
        entityId: id,
        entityLabel: updated.name,
        action: "update",
        summary: `Program access: ${describe(target.allowed_programs)} → ${describe(updated.allowed_programs)}${
          updated.primary_program ? ` (primary: ${updated.primary_program})` : ""
        }`,
      });
    }

    // Re-include `pending_invite` so the UI doesn't regress to
    // "active but no sign-in state" after an update. Pull the
    // current last_sign_in_at for this one user.
    const supabase = getServiceRoleClient();
    const { data: authView } = await supabase.auth.admin.getUserById(id);
    const lastSignInById = buildLastSignInIndex(
      authView?.user
        ? [
            {
              id: authView.user.id,
              last_sign_in_at: authView.user.last_sign_in_at ?? null,
            },
          ]
        : [],
    );

    return NextResponse.json({
      user: toAdminUser(updated, lastSignInById.get(id) ?? null),
    });
  },
);
