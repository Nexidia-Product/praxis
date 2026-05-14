/**
 * Saved Kanban configurations API (Section 5.5).
 *
 *   GET    /api/roadmap/kanban-configs             List configs.
 *   POST   /api/roadmap/kanban-configs             Save a new config.
 *   DELETE /api/roadmap/kanban-configs?id=<uuid>   Delete one config.
 *
 * Configs are stored as an array on `AppSettings.kanban_configs`. We don't
 * use a separate JSON file because the design document is explicit about
 * keeping the seven core entity files at seven (Section 3.3) — Kanban
 * configurations are app-level metadata, not an entity in their own right.
 *
 * Permissions: any authenticated user can save and delete configs. There
 * is no per-user scoping yet — the configs are shared across the team,
 * which matches how the projects-table filter set is shared. If team-wide
 * pollution becomes a problem, add a `created_by` filter on the GET.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { requireSession, withAuth } from "@/lib/auth/permissions";
import {
  SettingsRepository,
  type SavedKanbanConfig,
} from "@/lib/db";
import { findKanbanField } from "@/lib/roadmap/fields";

export const GET = withAuth(async () => {
  await requireSession();
  const settings = await SettingsRepository.get();
  return NextResponse.json({ configs: settings.kanban_configs });
});

interface CreateConfigPayload {
  name?: unknown;
  column_field?: unknown;
  swimlane_field?: unknown;
  wip_limits?: unknown;
  column_order?: unknown;
}

export const POST = withAuth(async (request: Request) => {
  const session = await requireSession();
  let body: CreateConfigPayload;
  try {
    body = (await request.json()) as CreateConfigPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Configuration name is required." },
      { status: 400 },
    );
  }
  if (
    typeof body.column_field !== "string" ||
    !findKanbanField(body.column_field)
  ) {
    return NextResponse.json(
      { error: "column_field is required and must be a known Kanban field." },
      { status: 400 },
    );
  }
  let swimlane_field: string | null = null;
  if (
    body.swimlane_field !== undefined &&
    body.swimlane_field !== null &&
    body.swimlane_field !== ""
  ) {
    if (
      typeof body.swimlane_field !== "string" ||
      !findKanbanField(body.swimlane_field)
    ) {
      return NextResponse.json(
        {
          error:
            "swimlane_field must be either null or a known Kanban field.",
        },
        { status: 400 },
      );
    }
    if (body.swimlane_field === body.column_field) {
      return NextResponse.json(
        { error: "swimlane_field cannot equal column_field." },
        { status: 400 },
      );
    }
    swimlane_field = body.swimlane_field;
  }

  const wip_limits: Record<string, number> = {};
  if (body.wip_limits && typeof body.wip_limits === "object") {
    for (const [k, v] of Object.entries(
      body.wip_limits as Record<string, unknown>,
    )) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n > 0) {
        wip_limits[k] = Math.floor(n);
      }
    }
  }

  const column_order: string[] = [];
  if (Array.isArray(body.column_order)) {
    for (const v of body.column_order) {
      if (typeof v === "string" && v.trim()) {
        column_order.push(v.trim());
      }
    }
  }

  const settings = await SettingsRepository.get();
  const config: SavedKanbanConfig = {
    config_id: randomUUID(),
    name,
    column_field: body.column_field,
    swimlane_field,
    wip_limits,
    column_order,
    created_by: session.user.user_id,
    created_at: new Date().toISOString(),
  };
  const next = [...settings.kanban_configs, config];
  await SettingsRepository.update({ kanban_configs: next });
  return NextResponse.json({ config }, { status: 201 });
});

export const DELETE = withAuth(async (request: Request) => {
  await requireSession();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "id query parameter is required." },
      { status: 400 },
    );
  }
  const settings = await SettingsRepository.get();
  const before = settings.kanban_configs.length;
  const next = settings.kanban_configs.filter((c) => c.config_id !== id);
  if (next.length === before) {
    return NextResponse.json(
      { error: "Configuration not found." },
      { status: 404 },
    );
  }
  await SettingsRepository.update({ kanban_configs: next });
  return NextResponse.json({ deleted: true });
});
