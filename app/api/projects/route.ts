/**
 * Projects collection API.
 *
 *   GET  /api/projects   List all projects. Any authenticated user.
 *   POST /api/projects   Create a project. Admin or Project Lead only.
 *
 * The middleware has already verified a session exists; the role check
 * here gates *creation* — Section 4.7 lists "create/edit own projects"
 * as a Project Lead capability and Team Members as read-only on projects.
 *
 * GET returns the raw Project records since they're already scrubbed of
 * any secret material. The Projects page (Section 5.1) does its filtering
 * client-side over this payload to keep the page snappy without the
 * complexity of server-side query strings on top of the JSON store.
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import { ProjectRepository } from "@/lib/db";
import {
  ValidationError,
  createProject,
  type ProjectCreatePayload,
} from "@/lib/projects/service";

export const GET = withAuth(async () => {
  await requireSession();
  const projects = await ProjectRepository.getAll();
  // Stable, predictable order: most-recent first by date_added, with a
  // secondary sort on project_id so equal-date entries don't shuffle.
  projects.sort((a, b) => {
    if (a.date_added !== b.date_added) {
      return a.date_added < b.date_added ? 1 : -1;
    }
    return a.project_id < b.project_id ? 1 : -1;
  });
  return NextResponse.json({ projects });
});

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("projects.create");

  let body: ProjectCreatePayload;
  try {
    body = (await request.json()) as ProjectCreatePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const project = await createProject(body, {
      createdBy: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
