/**
 * PUT /api/projects/[id]/key-capability
 *
 * Body: { is_key_capability?: boolean, key_capability_quarter?: string | null }
 *
 * Designate a project as a key capability and/or slot it into a quarter.
 * Gated by `key_capabilities.manage` (Admin only by default) — separate
 * from `projects.edit` so routine project editing doesn't imply control
 * over the strategic key-capability set. The per-quarter cap and quarter
 * validation live in `setKeyCapability` in the service layer.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  ValidationError,
  setKeyCapability,
  type KeyCapabilityPatch,
} from "@/lib/projects/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PUT = withAuth(async (request: Request, ctx: RouteContext) => {
  const session = await requirePermission("key_capabilities.manage");
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const patch: KeyCapabilityPatch = {};
  if (typeof body.is_key_capability === "boolean") {
    patch.is_key_capability = body.is_key_capability;
  }
  if ("key_capability_quarter" in body) {
    const q = body.key_capability_quarter;
    if (q === null || typeof q === "string") {
      patch.key_capability_quarter = q;
    } else {
      return NextResponse.json(
        { error: "key_capability_quarter must be a string or null." },
        { status: 400 },
      );
    }
  }
  if (
    patch.is_key_capability === undefined &&
    patch.key_capability_quarter === undefined
  ) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 },
    );
  }

  try {
    const project = await setKeyCapability(id, patch, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
