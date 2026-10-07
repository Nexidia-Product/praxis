/**
 * POST /api/export/executive-deck
 *
 * Builds the executive PowerPoint deck from the same data the Executive
 * view shows. Body (all validated here):
 *
 *   {
 *     preset:   "monthly" | "qbr",
 *     scope:    "YYYY-Qn" | "unscheduled",
 *     pillars:  string[]            // subset of the five core pillars
 *     sections: DeckSection[]       // which slide groups to include
 *     detail:   "summary" | "detailed",
 *     title?:   string
 *   }
 *
 * Gated by `roadmap.export`, same as the roadmap deck. The data is loaded
 * server-side (program-scoped to the caller); nothing about the portfolio
 * is trusted from the client. Branding comes from the same template the
 * roadmap export uses.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { SettingsRepository } from "@/lib/db";
import { loadExecutiveData } from "@/lib/executive/load";
import {
  DECK_PRESETS,
  DECK_SECTIONS,
  buildDeckPlan,
  type DeckDetail,
  type DeckOptions,
  type DeckPreset,
  type DeckSection,
} from "@/lib/executive/deck";
import { EXEC_PILLARS, UNSCHEDULED } from "@/lib/executive/portfolio";
import { loadTemplateBranding } from "@/lib/export/template";
import { addExecutiveSlide } from "@/lib/export/executive-slides";
import { addTitleSlide } from "@/lib/export/slide-builders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class ValidationError extends Error {}

const QUARTER_RE = /^\d{4}-Q[1-4]$/;

function parseOptions(raw: unknown): DeckOptions {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Body must be a JSON object.");
  }
  const o = raw as Record<string, unknown>;

  const preset = o.preset;
  if (preset !== "monthly" && preset !== "qbr") {
    throw new ValidationError("`preset` must be \"monthly\" or \"qbr\".");
  }

  const scope = o.scope;
  if (typeof scope !== "string" || !(scope === UNSCHEDULED || QUARTER_RE.test(scope))) {
    throw new ValidationError("`scope` must be a quarter like 2026-Q4 or \"unscheduled\".");
  }

  const pillars = Array.isArray(o.pillars) ? o.pillars : null;
  if (!pillars || pillars.length === 0 || pillars.some((p) => !EXEC_PILLARS.includes(p as string))) {
    throw new ValidationError("`pillars` must be a non-empty list of the core pillars.");
  }

  const validSections = new Set<string>(DECK_SECTIONS.map((s) => s.key));
  const sections = Array.isArray(o.sections) ? o.sections : null;
  if (!sections || sections.length === 0 || sections.some((s) => !validSections.has(s as string))) {
    throw new ValidationError("`sections` must be a non-empty list of known sections.");
  }

  const detail = o.detail;
  if (detail !== "summary" && detail !== "detailed") {
    throw new ValidationError("`detail` must be \"summary\" or \"detailed\".");
  }

  let title: string | undefined;
  if (o.title !== undefined && o.title !== null && o.title !== "") {
    if (typeof o.title !== "string" || o.title.trim().length > 200) {
      throw new ValidationError("`title` must be a string of 200 characters or fewer.");
    }
    title = o.title.trim();
  }

  return {
    preset: preset as DeckPreset,
    scope,
    pillars: pillars as string[],
    sections: sections as DeckSection[],
    detail: detail as DeckDetail,
    title,
  };
}

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("roadmap.export");

  let options: DeckOptions;
  try {
    options = parseOptions(await request.json());
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { today, entries, noPillarCount } = await loadExecutiveData(session);
  const plan = buildDeckPlan({ entries, today, noPillarCount, options });

  const settings = await SettingsRepository.get();
  const branding = await loadTemplateBranding(settings.branding);

  const PptxGenJSModule = await import("pptxgenjs");
  const PptxGenJS =
    (PptxGenJSModule as unknown as { default: typeof PptxGenJSModule.default })
      .default ?? PptxGenJSModule;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = plan.title;
  pptx.author = "Praxis";
  pptx.company = "Praxis";

  addTitleSlide(pptx, branding, {
    title: plan.title,
    subtitle: plan.subtitle,
    coverImageDataUrl: branding.coverImageDataUrl,
  });
  for (const slide of plan.slides) addExecutiveSlide(pptx, branding, slide);

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const filename = `Praxis_Executive_${options.preset === "qbr" ? "QBR" : "Monthly"}_${today}.pptx`;

  return new Response(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

// Re-exported for tests/tools that want the preset defaults next to the route.
export { DECK_PRESETS };
