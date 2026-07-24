/**
 * POST /api/ai/documents/generate
 *
 * Body: { projectId: string, skillKey?: string }   // skillKey defaults to "prfaq"
 * Returns: the persisted GeneratedDocument row (status "draft").
 *
 * Generates a draft document from a Praxis project using an authored
 * document skill, then saves it to `generated_documents` so it can be
 * edited, regenerated, and later published. Local-first, like the other
 * AI routes — gated by AI_ENABLED.
 *
 * Permission: projects.edit — whoever can edit a project can generate
 * its documentation.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { GeneratedDocumentRepository, ProjectRepository } from "@/lib/db";
import { AiDisabledError, isAiEnabled } from "@/lib/ai/feature-flag";
import { generateDocument } from "@/lib/ai/documents/generate";
import { loadSkill } from "@/lib/ai/documents/loader";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Generation does section-by-section model calls plus (optionally)
// fetches linked GitHub Markdown docs, so give it headroom over the
// default serverless budget.
export const maxDuration = 30;

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("projects.edit");

  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: new AiDisabledError().message },
      { status: 503 },
    );
  }

  let body: { projectId?: unknown; skillKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : "";
  const skillKey =
    typeof body.skillKey === "string" && body.skillKey.trim()
      ? body.skillKey.trim()
      : "prfaq";
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required." },
      { status: 400 },
    );
  }

  const project = await ProjectRepository.getById(projectId);
  if (!project) {
    return NextResponse.json(
      { error: `Project ${projectId} not found.` },
      { status: 404 },
    );
  }

  try {
    const skill = await loadSkill(skillKey);
    const draft = await generateDocument(skill, project);
    const saved = await GeneratedDocumentRepository.create({
      project_id: project.project_id,
      skill_key: skill.key,
      skill_version: skill.version,
      title: draft.title,
      markdown: draft.markdown,
      sections: draft.sections,
      status: "draft",
      model_id: draft.model_id,
      usage: draft.usage,
      confluence_page_id: null,
      confluence_url: null,
      created_by: session.user.user_id,
    });
    return NextResponse.json(saved);
  } catch (err) {
    console.error("[ai/documents/generate] failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Document generation failed. Check server logs.",
      },
      { status: 502 },
    );
  }
});
