/**
 * Audit log API.
 *
 *   GET /api/admin/audit-log
 *
 * Admin-only read of the audit log (Step 13 / Section 5.19). Supports
 * the filter chips on the Admin → Audit Log page via query string:
 *
 *   ?entity_type=Project|Task|Idea|User|Decision|Template|Settings
 *   ?action=create|update|delete|status_change|...
 *   ?actor_id=<user_id>
 *   ?q=<free-text>          — substring search over entity_label + summary
 *   ?limit=<n>              — capped at 1000 in the repository
 *
 * Filters compose (AND). Results are returned newest-first.
 *
 * The audit log itself records *who* changed *what*; this route does
 * not produce additional audit entries when read (read access is not
 * mutating).
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  AuditLogRepository,
  type AuditAction,
  type AuditEntityType,
  type RecentAuditQuery,
} from "@/lib/db";

const ENTITY_TYPES: AuditEntityType[] = [
  "Project",
  "Task",
  "Idea",
  "User",
  "Decision",
  "Template",
  "Settings",
];

const ACTIONS: AuditAction[] = [
  "create",
  "update",
  "delete",
  "status_change",
  "convert",
  "invite",
  "deactivate",
  "activate",
  "role_change",
  "password_reset",
];

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: Request) => {
  await requirePermission("admin.audit_log.view");

  const { searchParams } = new URL(request.url);
  const query: RecentAuditQuery = {};

  const entityType = searchParams.get("entity_type");
  if (entityType && (ENTITY_TYPES as string[]).includes(entityType)) {
    query.entity_type = entityType as AuditEntityType;
  }

  const action = searchParams.get("action");
  if (action && (ACTIONS as string[]).includes(action)) {
    query.action = action as AuditAction;
  }

  const actorId = searchParams.get("actor_id");
  if (actorId) {
    query.actor_id = actorId === "system" ? null : actorId;
  }

  const q = searchParams.get("q");
  if (q && q.trim()) query.q = q.trim();

  const limit = searchParams.get("limit");
  if (limit) {
    const n = Number.parseInt(limit, 10);
    if (Number.isFinite(n) && n > 0) query.limit = n;
  }

  const entries = await AuditLogRepository.getRecent(query);
  return NextResponse.json({ entries, total: entries.length });
});
