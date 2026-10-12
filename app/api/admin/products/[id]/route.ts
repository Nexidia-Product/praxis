/**
 * /api/admin/products/[id]
 *
 *   PUT → rename, re-describe, or (un)deprecate a NiCE product.
 *
 * Gated by `products.manage` (Admin-only by default). No DELETE: retire a
 * product by setting `deprecated`.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  NotFoundError,
  ValidationError,
  updateNiceProduct,
} from "@/lib/products/service";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const PUT = withAuth(async (request: Request, context: RouteContext) => {
  const session = await requirePermission("products.manage");
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const product = await updateNiceProduct(
      id,
      (body ?? {}) as Parameters<typeof updateNiceProduct>[1],
      { userId: session.user.user_id, userName: session.user.name },
    );
    return NextResponse.json({ product });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});
