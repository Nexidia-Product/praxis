/**
 * /api/admin/products
 *
 *   GET  → list every NiCE product, deprecated included (products.manage).
 *   POST → add a product (products.manage).
 *
 * `products.manage` is Admin-only by default.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { NiceProductRepository } from "@/lib/db";
import { ValidationError, createNiceProduct } from "@/lib/products/service";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  await requirePermission("products.manage");
  return NextResponse.json({ products: await NiceProductRepository.getAll() });
});

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("products.manage");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const product = await createNiceProduct(
      (body ?? {}) as Parameters<typeof createNiceProduct>[0],
      { userId: session.user.user_id, userName: session.user.name },
    );
    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
