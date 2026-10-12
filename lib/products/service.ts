/**
 * NiCE product service.
 *
 * API routes never call NiceProductRepository directly: validation and
 * audit emission live here. Access control (`products.manage`, Admin-only
 * by default) is enforced at the route layer. There is deliberately no
 * delete — retire a product by setting `deprecated`.
 */

import {
  NiceProductRepository,
  type NiceProduct,
  type NiceProductId,
  type UserId,
} from "@/lib/db";
import { audit } from "@/lib/audit/service";
import { validateProductFields } from "@/lib/products/logic";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NiceProductValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NiceProductNotFoundError";
  }
}

export interface NiceProductPayload {
  name?: unknown;
  description?: unknown;
  deprecated?: unknown;
}

interface ActorCtx {
  userId: UserId;
  userName: string | null;
}

function fields(payload: NiceProductPayload, requireName: boolean) {
  const r = validateProductFields(payload.name, payload.description, requireName);
  if (!r.ok) throw new ValidationError(r.error);
  return r.value;
}

function parseDeprecated(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") throw new ValidationError("deprecated must be a boolean.");
  return raw;
}

async function assertNameFree(name: string, selfId: NiceProductId | null) {
  const taken = (await NiceProductRepository.getAll()).find(
    (p) => p.product_id !== selfId && p.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) throw new ValidationError(`A product named "${taken.name}" already exists.`);
}

export async function createNiceProduct(
  payload: NiceProductPayload,
  actor: ActorCtx,
): Promise<NiceProduct> {
  const { name, description } = fields(payload, true);
  await assertNameFree(name!, null);
  const created = await NiceProductRepository.create({
    name: name!,
    description: description ?? "",
    deprecated: parseDeprecated(payload.deprecated) ?? false,
  });
  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings",
    entityId: created.product_id,
    entityLabel: `NiCE product: ${created.name}`,
    action: "create",
    summary: `Added NiCE product "${created.name}".`,
  });
  return created;
}

export async function updateNiceProduct(
  id: NiceProductId,
  payload: NiceProductPayload,
  actor: ActorCtx,
): Promise<NiceProduct> {
  const before = await NiceProductRepository.getById(id);
  if (!before) throw new NotFoundError(`NiCE product ${id} not found.`);

  const { name, description } = fields(payload, false);
  const deprecated = parseDeprecated(payload.deprecated);
  const patch: { name?: string; description?: string; deprecated?: boolean } = {};
  if (name !== undefined && name !== before.name) {
    await assertNameFree(name, id);
    patch.name = name;
  }
  if (description !== undefined && description !== before.description) {
    patch.description = description;
  }
  if (deprecated !== undefined && deprecated !== before.deprecated) {
    patch.deprecated = deprecated;
  }
  if (Object.keys(patch).length === 0) return before;

  const after = await NiceProductRepository.update(id, patch);
  const parts: string[] = [];
  if (patch.name) parts.push(`name: "${before.name}" → "${after.name}"`);
  if (patch.description !== undefined) parts.push("description updated");
  if (patch.deprecated !== undefined) {
    parts.push(patch.deprecated ? "marked deprecated" : "restored (no longer deprecated)");
  }
  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings",
    entityId: id,
    entityLabel: `NiCE product: ${after.name}`,
    action: "update",
    summary: parts.join("; "),
  });
  return after;
}
