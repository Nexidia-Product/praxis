/**
 * PPTX export API (Section 5.9, Step 5b of Section 9).
 *
 *   POST /api/export/pptx
 *
 * Generates a roadmap deck on demand. The client builds the request
 * payload (`ExportPptxRequest` in `lib/export/payload.ts`), captures the
 * raster slides via html2canvas, and posts everything in one go. The
 * response is a binary `.pptx` file with a `Content-Disposition` that
 * triggers a browser download.
 *
 * Architectural notes:
 *
 *   - We load projects, tasks, and settings server-side rather than
 *     trusting the client payload for the data itself. The client only
 *     supplies what the server can't reconstruct: the html2canvas
 *     captures, the deck title/subtitle, and the slide selection.
 *
 *   - Filters are inherited from the active roadmap workspace and apply
 *     to every native slide. The same filter applied to a raster slide
 *     was already in effect when html2canvas captured the view, so the
 *     two stay in sync without any extra plumbing.
 *
 *   - Date range is currently consumed by raster slides only (the
 *     timeline view reads it client-side before capture). The native
 *     slides ignore it — they're project lists, not time plots — so
 *     we accept the field for forward-compatibility but don't pass it
 *     through here.
 *
 *   - All authenticated roles can export. Section 4.7 lets Viewer roles
 *     "view projects and roadmap"; a deck is just a different rendering
 *     of the same view, so gating the export to a higher role would
 *     be inconsistent with that.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  IdeaRepository,
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
} from "@/lib/db";
import { applyRoadmapFilters, type RoadmapFilters } from "@/lib/roadmap/filters";
import {
  toPptxHex,
} from "@/lib/export/branding";
import { loadTemplateBranding } from "@/lib/export/template";
import {
  exportFilename,
  type ExportPptxRequest,
  type SlideCapture,
} from "@/lib/export/payload";
import {
  isSlideKind,
  selectedSlides,
  type SlideKind,
} from "@/lib/export/slide-types";
import {
  addBlockedAtRiskSlide,
  addNowNextLaterSlide,
  addProjectsStatusSlide,
  addRasterSlide,
  addTitleSlide,
  addVelocitySlide,
} from "@/lib/export/slide-builders";
import {
  computeVelocityMetrics,
  resolveRange,
} from "@/lib/velocity/metrics";

// pptxgenjs' write path is heavy — make sure the route never tries to
// run on the edge runtime, where Node Buffer + filesystem-style APIs
// aren't available.
export const runtime = "nodejs";
// Avoid Next caching a binary response keyed off the URL; this is
// always a fresh build per request.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * Coerce an unknown payload into a well-typed `ExportPptxRequest`. We
 * accept the request defensively — the client is trusted for shape
 * (it's our own code) but a stale build, a botched fetch wrapper, or
 * a manual curl could send us anything.
 */
function parseRequest(raw: unknown): ExportPptxRequest {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Body must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) throw new ValidationError("`title` is required.");
  if (title.length > 200) {
    throw new ValidationError("`title` must be 200 characters or fewer.");
  }

  const subtitle =
    typeof obj.subtitle === "string" ? obj.subtitle.trim() : undefined;

  const slidesRaw = obj.slides;
  if (!Array.isArray(slidesRaw) || slidesRaw.length === 0) {
    throw new ValidationError("`slides` must be a non-empty array.");
  }
  const seen = new Set<SlideKind>();
  for (const s of slidesRaw) {
    if (typeof s !== "string" || !isSlideKind(s)) {
      throw new ValidationError(`Unknown slide kind: ${String(s)}`);
    }
    seen.add(s);
  }

  const filters = parseFilters(obj.filters);
  const captures = parseCaptures(obj.captures);
  const branding = parseBranding(obj.branding);

  return {
    title,
    subtitle,
    slides: Array.from(seen),
    filters,
    captures,
    branding,
  };
}

function parseFilters(raw: unknown): RoadmapFilters {
  if (!raw || typeof raw !== "object") {
    return {
      status: [],
      phase: [],
      priority: [],
      project_type: [],
      project_lead: [],
      application_product: [],
      search: "",
    };
  }
  const f = raw as Record<string, unknown>;
  // Each list is coerced into a string array; the filter code is
  // tolerant of unknown enum values (they simply fail to match), so
  // we don't need stricter narrowing here.
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  return {
    status: arr(f.status) as RoadmapFilters["status"],
    phase: arr(f.phase) as RoadmapFilters["phase"],
    priority: arr(f.priority) as RoadmapFilters["priority"],
    project_type: arr(f.project_type) as RoadmapFilters["project_type"],
    project_lead: arr(f.project_lead),
    application_product: arr(f.application_product),
    search: typeof f.search === "string" ? f.search : "",
  };
}

/**
 * Per-capture payload size limit. A 2x html2canvas capture of a
 * 1400x600 view is roughly 800 KB encoded, so 4 MB per capture leaves
 * generous headroom while still rejecting accidental whole-page
 * captures or pranks.
 */
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

function parseCaptures(
  raw: unknown,
): Partial<Record<SlideKind, SlideCapture>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<SlideKind, SlideCapture>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSlideKind(k)) continue;
    if (!v || typeof v !== "object") continue;
    const cap = v as Record<string, unknown>;
    const dataUrl = cap.data_url;
    const width = cap.width;
    const height = cap.height;
    if (
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/") ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      continue;
    }
    if (dataUrl.length > MAX_CAPTURE_BYTES) {
      throw new ValidationError(
        `Capture for "${k}" exceeds the ${MAX_CAPTURE_BYTES / 1024 / 1024} MB limit.`,
      );
    }
    out[k] = { data_url: dataUrl, width, height };
  }
  return out;
}

interface ParsedBranding {
  primary_color?: string;
  secondary_color?: string;
  font?: string;
}

function parseBranding(raw: unknown): ParsedBranding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const out: ParsedBranding = {};
  if (typeof b.primary_color === "string") out.primary_color = b.primary_color;
  if (typeof b.secondary_color === "string") {
    out.secondary_color = b.secondary_color;
  }
  if (typeof b.font === "string") out.font = b.font;
  return out;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ---------------------------------------------------------------------------
// Slide kind labels for the right-hand context line in raster slide headers
// ---------------------------------------------------------------------------

const RASTER_SLIDE_TITLES: Record<SlideKind, string> = {
  title: "",
  timeline: "Timeline",
  kanban: "Kanban board",
  bubble: "Portfolio bubble chart",
  "now-next-later": "",
  "projects-status": "",
  "blocked-at-risk": "",
  // Velocity is a native slide; the title is set inside the builder, not
  // here. Map it to "" so the Record stays exhaustive.
  velocity: "",
};

// ---------------------------------------------------------------------------
// Build orchestration
// ---------------------------------------------------------------------------

/**
 * Produce a one-line filter summary like "Status: In Progress · App: Auto
 * Insights" to print in raster slide headers. Lets a viewer scanning the
 * deck six months from now know which slice they're looking at.
 */
function summarizeFilters(filters: RoadmapFilters): string {
  const parts: string[] = [];
  if (filters.status.length) parts.push(`Status: ${filters.status.join(", ")}`);
  if (filters.priority.length) {
    parts.push(`Priority: ${filters.priority.join(", ")}`);
  }
  if (filters.application_product.length) {
    parts.push(`App: ${filters.application_product.join(", ")}`);
  }
  if (filters.project_type.length) {
    parts.push(`Type: ${filters.project_type.join(", ")}`);
  }
  if (filters.project_lead.length) {
    parts.push(`Lead: ${filters.project_lead.join(", ")}`);
  }
  if (filters.phase.length) parts.push(`Phase: ${filters.phase.join(", ")}`);
  if (filters.search) parts.push(`"${filters.search}"`);
  return parts.join("  ·  ");
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST = withAuth(async (request: Request) => {
  await requirePermission("roadmap.export");

  let payload: ExportPptxRequest;
  try {
    const json = await request.json();
    payload = parseRequest(json);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  const [allProjects, allTasks, settings] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
    SettingsRepository.get(),
  ]);

  // Velocity slide uses ideas (for the conversion-rate stat); load them
  // only when the slide was actually requested so the common cold path
  // isn't paying a JSON read it doesn't need.
  const wantsVelocity = payload.slides.includes("velocity");
  const allIdeas = wantsVelocity ? await IdeaRepository.getAll() : [];

  // The roadmap workspace decides whether to include closed projects
  // per-view; the export is a single multi-slide artifact, so we follow
  // the same default the views use (open-only) unless the filter set
  // explicitly names "Completed" or "Canceled". Naming a closed status
  // is a clear opt-in to including it.
  const filters = payload.filters;
  const includeClosed =
    filters.status.includes("Completed") ||
    filters.status.includes("Canceled");
  const filteredProjects = applyRoadmapFilters(allProjects, filters, {
    includeClosed,
  });

  // Tasks for the at-risk slide are scoped to the filtered project set.
  // A task whose parent project was filtered out shouldn't surface in
  // the deck — the reviewer would have no context for it.
  const projectIdSet = new Set(filteredProjects.map((p) => p.project_id));
  const filteredTasks = allTasks.filter((t) =>
    projectIdSet.has(t.project_id),
  );

  // Resolve branding with overrides. We prefer the brand identity from
  // `data/branding/template.pptx` (theme colors + font, plus optional
  // pre-rendered cover and content background images) when available;
  // the stored `BrandingConfig` is the fallback. Per-export overrides
  // from the modal still win — that's the user explicitly asking for a
  // one-off color tweak.
  const branding = await loadTemplateBranding(settings.branding, {
    primaryHex: payload.branding?.primary_color
      ? toPptxHex(payload.branding.primary_color, "")
      : undefined,
    secondaryHex: payload.branding?.secondary_color
      ? toPptxHex(payload.branding.secondary_color, "")
      : undefined,
    fontFace: payload.branding?.font?.trim() || undefined,
  });

  // pptxgenjs is heavy and not used elsewhere — load lazily so the
  // rest of the API surface doesn't pay the cost on every cold start.
  const PptxGenJSModule = await import("pptxgenjs");
  // The module's default export is the constructor in CJS; in ESM it's
  // also the default. We unwrap defensively in case the runtime hands
  // us the module record.
  const PptxGenJS =
    (PptxGenJSModule as unknown as { default: typeof PptxGenJSModule.default })
      .default ?? PptxGenJSModule;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = payload.title;
  pptx.author = "Praxis";
  pptx.company = "Praxis";

  // Ordered set of slides to build. We honor the catalog ordering, not
  // the order the client posted — the deck reads more naturally with
  // a consistent flow regardless of how the user clicked checkboxes.
  const wanted = new Set(payload.slides);
  const ordered = selectedSlides(wanted);

  const filterSummary = summarizeFilters(filters);

  for (const def of ordered) {
    switch (def.kind) {
      case "title": {
        addTitleSlide(pptx, branding, {
          title: payload.title,
          subtitle: payload.subtitle,
          coverImageDataUrl: branding.coverImageDataUrl,
        });
        break;
      }
      case "now-next-later": {
        addNowNextLaterSlide(pptx, branding, filteredProjects);
        break;
      }
      case "projects-status": {
        addProjectsStatusSlide(pptx, branding, filteredProjects);
        break;
      }
      case "blocked-at-risk": {
        addBlockedAtRiskSlide(
          pptx,
          branding,
          filteredProjects,
          filteredTasks,
        );
        break;
      }
      case "velocity": {
        // The export modal exposes a `dateRange` (Section 5.9) primarily
        // for timeline / capacity slides. The velocity slide reuses it as
        // a custom range when both endpoints are present, so the deck's
        // headline numbers match whatever window the reviewer is
        // discussing. If no range was given, fall back to "All time" so
        // the slide still renders with every completed project.
        const hasCustomRange =
          payload.dateRange &&
          payload.dateRange.start &&
          payload.dateRange.end;
        const velocityRange = hasCustomRange
          ? resolveRange("custom", new Date(), {
              start: payload.dateRange!.start,
              end: payload.dateRange!.end,
            })
          : resolveRange("all", new Date());
        const rangeLabel = hasCustomRange
          ? `${payload.dateRange!.start} → ${payload.dateRange!.end}`
          : "All time";

        const metrics = computeVelocityMetrics(
          filteredProjects,
          filteredTasks,
          allIdeas,
          {
            range: velocityRange,
            project_types: [],
            application_products: [],
            project_leads: [],
            individual_user_id: null,
          },
          new Date(),
        );

        addVelocitySlide(pptx, branding, {
          rangeLabel,
          totalCompleted: metrics.completed_by_quarter.total_completed,
          avgDaysToCompletion: metrics.avg_time_to_completion.overall_avg_days,
          avgSampleSize: metrics.avg_time_to_completion.sample_size,
          meanTasksPerWeek: metrics.task_throughput.mean_per_week,
          totalTasksCompleted: metrics.task_throughput.total_completed,
          ideaConversionRate: metrics.idea_conversion.conversion_rate,
          ideasSubmitted: metrics.idea_conversion.total_submitted,
          ideasConverted: metrics.idea_conversion.total_converted,
          insufficientHistory: metrics.insufficient_history,
        });
        break;
      }
      case "timeline":
      case "kanban":
      case "bubble": {
        const capture = payload.captures?.[def.kind];
        if (!capture) {
          // The client should always send captures for raster slides
          // it requested, but if it didn't, we'd rather skip the slide
          // silently than crash the whole export. The user gets the
          // rest of the deck and can re-run with all required views.
          break;
        }
        addRasterSlide(pptx, branding, {
          title: RASTER_SLIDE_TITLES[def.kind] || def.label,
          rightHeader: filterSummary,
          capture,
        });
        break;
      }
    }
  }

  // If the user selected only raster slides and supplied no captures,
  // the deck will be empty — which produces a malformed file. Surface
  // a 400 instead of returning a broken artifact.
  // Reading internal state isn't strictly supported by the public API,
  // but `_slides` has been stable for years; double-checking the
  // length is cheaper than parsing the result.
  const internalSlides =
    (pptx as unknown as { _slides?: unknown[] })._slides ?? [];
  if (internalSlides.length === 0) {
    return NextResponse.json(
      {
        error:
          "No slides were produced. Ensure the export modal supplied captures for raster slides.",
      },
      { status: 400 },
    );
  }

  // Output as a Node Buffer — pptxgenjs supports `nodebuffer` directly
  // when the runtime is Node, which is the case here (`runtime` is
  // pinned above).
  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const filename = exportFilename();

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
