"use client";

/**
 * PPTX export modal (Section 5.9, Step 5b of Section 9).
 *
 * Surfaces the four pieces of configuration the design doc calls out:
 *
 *   - Slide picker (which slide types to include)
 *   - Title + subtitle for the deck
 *   - Branding overrides (primary / secondary / font)
 *   - Filter inheritance (passed in by the workspace; rendered as a
 *     read-only summary so the user knows the deck honors the active
 *     filter set)
 *
 * The modal owns the export flow:
 *
 *   1. User picks slides + tweaks config, clicks "Export deck".
 *   2. For each selected raster slide, we mount the corresponding view
 *      off-screen via `captureRoadmapView` and collect the PNG capture.
 *   3. POST `/api/export/pptx` with the slide selection, captures,
 *      filters, and branding overrides.
 *   4. The API returns the binary `.pptx`; we trigger a browser download
 *      via an anchor click on a Blob URL.
 *
 * Errors at any step land in the modal as a banner so the user can
 * retry without losing their selections.
 */

import { useEffect, useMemo, useState } from "react";

import { captureRoadmapView } from "@/components/roadmap/export-renderer";
import {
  SLIDE_TYPES,
  type SlideKind,
  type SlideTypeDef,
} from "@/lib/export/slide-types";
import {
  exportFilename,
  type ExportPptxRequest,
  type SlideCapture,
} from "@/lib/export/payload";
import type { RoadmapFilters } from "@/lib/roadmap/filters";
import type {
  PortfolioQuadrantLabels,
  Project,
  SavedKanbanConfig,
} from "@/lib/db";

interface ExportModalProps {
  /** Closing the modal — caller controls visibility. */
  onClose: () => void;
  /** Filters currently applied to the on-page roadmap; inherited by the deck. */
  filters: RoadmapFilters;
  /** Project list passed through to the off-screen views. */
  projects: Project[];
  /** Saved Kanban configs passed through to the off-screen Kanban view. */
  savedConfigs: SavedKanbanConfig[];
  /** Strategic-position labels for the off-screen Kanban and bubble views. */
  quadrantLabels: PortfolioQuadrantLabels;
  /** Optional default deck title (falls back to a generic one if omitted). */
  defaultTitle?: string;
}

/**
 * Capture progress state. We surface it inline so a long export (4+
 * raster slides) shows a per-slide spinner instead of a dead UI.
 */
type Phase =
  | { kind: "idle" }
  | { kind: "capturing"; current: SlideKind; total: number; done: number }
  | { kind: "uploading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function ExportModal({
  onClose,
  filters,
  projects,
  savedConfigs,
  quadrantLabels,
  defaultTitle,
}: ExportModalProps) {
  const [title, setTitle] = useState<string>(
    defaultTitle ?? "Roadmap review",
  );
  const [subtitle, setSubtitle] = useState<string>("");
  const [selected, setSelected] = useState<Set<SlideKind>>(() => {
    const init = new Set<SlideKind>();
    for (const s of SLIDE_TYPES) {
      if (s.defaultOn) init.add(s.kind);
    }
    return init;
  });
  const [primaryColor, setPrimaryColor] = useState<string>("");
  const [secondaryColor, setSecondaryColor] = useState<string>("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Close on Escape — standard modal affordance, costs us nothing.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && phase.kind !== "capturing" && phase.kind !== "uploading") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, phase.kind]);

  const filterSummary = useMemo(() => summarizeFilters(filters), [filters]);

  const selectedDefs = useMemo(
    () => SLIDE_TYPES.filter((s) => selected.has(s.kind)),
    [selected],
  );
  const rasterDefs = selectedDefs.filter((s) => s.category === "raster");

  function toggleSlide(kind: SlideKind) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(SLIDE_TYPES.map((s) => s.kind)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleExport() {
    if (selected.size === 0) {
      setPhase({ kind: "error", message: "Pick at least one slide first." });
      return;
    }
    if (!title.trim()) {
      setPhase({ kind: "error", message: "Add a deck title." });
      return;
    }

    setPhase({ kind: "idle" });

    // Capture raster slides one at a time. Sequential is intentional:
    // running html2canvas in parallel competes for the same main thread
    // and produces visibly-worse captures (and on slower laptops, OOM).
    const captures: Partial<Record<SlideKind, SlideCapture>> = {};
    for (let i = 0; i < rasterDefs.length; i++) {
      const def = rasterDefs[i];
      if (!def.view) continue; // type guard; raster slides always have a view
      setPhase({
        kind: "capturing",
        current: def.kind,
        total: rasterDefs.length,
        done: i,
      });
      try {
        const capture = await captureRoadmapView(def.view, {
          projects,
          savedConfigs,
          quadrantLabels,
        });
        captures[def.kind] = capture;
      } catch (err) {
        setPhase({
          kind: "error",
          message: `Couldn't capture ${def.label}: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        });
        return;
      }
    }

    setPhase({ kind: "uploading" });

    const request: ExportPptxRequest = {
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      slides: Array.from(selected),
      filters,
      captures,
      branding: buildBrandingOverrides(primaryColor, secondaryColor),
    };

    let response: Response;
    try {
      response = await fetch("/api/export/pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch (err) {
      setPhase({
        kind: "error",
        message: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
      });
      return;
    }

    if (!response.ok) {
      let message = `Export failed (status ${response.status}).`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        /* response wasn't JSON; keep the generic message */
      }
      setPhase({ kind: "error", message });
      return;
    }

    // Download the .pptx via a temporary anchor. The browser follows
    // the Content-Disposition filename, so we just need to trigger the
    // navigation; the URL itself is a Blob we revoke immediately.
    const blob = await response.blob();
    const filename = exportFilename();
    triggerDownload(blob, filename);
    setPhase({ kind: "done" });
  }

  const isBusy = phase.kind === "capturing" || phase.kind === "uploading";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-gray-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2
              id="export-modal-title"
              className="text-lg font-semibold tracking-tight text-gray-900"
            >
              Export PPTX deck
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Pick which slides to include. The active filter set is applied to
              every slide.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            <span aria-hidden className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* ---- Title + subtitle ---- */}
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Deck details
            </legend>
            <div className="mt-2 space-y-2">
              <label className="block">
                <span className="text-sm text-gray-700">Title</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isBusy}
                  maxLength={200}
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
                  placeholder="Quarterly roadmap review"
                />
              </label>
              <label className="block">
                <span className="text-sm text-gray-700">
                  Subtitle <span className="text-gray-400">(optional)</span>
                </span>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  disabled={isBusy}
                  maxLength={200}
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
                  placeholder="Q2 2026 portfolio"
                />
              </label>
            </div>
          </fieldset>

          {/* ---- Filter summary ---- */}
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Inherited filters
            </legend>
            <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
              {filterSummary || (
                <span className="italic text-gray-500">
                  No filters active — every project will be included.
                </span>
              )}
            </div>
          </fieldset>

          {/* ---- Slide picker ---- */}
          <fieldset>
            <div className="flex items-baseline justify-between">
              <legend className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Slides
              </legend>
              <div className="space-x-3 text-xs">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={isBusy}
                  className="text-gray-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={selectNone}
                  disabled={isBusy}
                  className="text-gray-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Select none
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {SLIDE_TYPES.map((s) => (
                <SlideOption
                  key={s.kind}
                  slide={s}
                  checked={selected.has(s.kind)}
                  onToggle={() => toggleSlide(s.kind)}
                  disabled={isBusy}
                />
              ))}
            </div>
          </fieldset>

          {/* ---- Branding overrides ---- */}
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700">
              Branding overrides
              <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-gray-400">
                — defaults to admin settings
              </span>
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <ColorInput
                label="Primary color"
                value={primaryColor}
                onChange={setPrimaryColor}
                disabled={isBusy}
                placeholder="#1f2937"
              />
              <ColorInput
                label="Secondary color"
                value={secondaryColor}
                onChange={setSecondaryColor}
                disabled={isBusy}
                placeholder="#3b82f6"
              />
            </div>
          </details>

          {/* ---- Status banner ---- */}
          {phase.kind === "capturing" && (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Capturing {phase.current} ({phase.done + 1} of {phase.total})…
            </div>
          )}
          {phase.kind === "uploading" && (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Building deck…
            </div>
          )}
          {phase.kind === "done" && (
            <div
              role="status"
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              Deck downloaded.
            </div>
          )}
          {phase.kind === "error" && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {phase.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase.kind === "done" ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isBusy || selected.size === 0}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? "Exporting…" : "Export deck"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SlideOption({
  slide,
  checked,
  onToggle,
  disabled,
}: {
  slide: SlideTypeDef;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ${
        checked
          ? "border-gray-900 bg-gray-50"
          : "border-gray-200 hover:border-gray-300"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{slide.label}</span>
          {slide.category === "raster" && (
            <span className="rounded-sm bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-800">
              Capture
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-tight text-gray-500">
          {slide.description}
        </p>
      </div>
    </label>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          // Browser color inputs require a 7-char hex; show a dim
          // default if the user hasn't typed anything.
          value={isHex7(value) ? value : "#1f2937"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-12 cursor-pointer rounded border border-gray-200 bg-white p-0.5 disabled:cursor-not-allowed"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 font-mono text-xs focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50"
        />
      </div>
    </label>
  );
}

function isHex7(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  if (filters.search) parts.push(`Search: "${filters.search}"`);
  return parts.join("  ·  ");
}

function buildBrandingOverrides(
  primary: string,
  secondary: string,
): ExportPptxRequest["branding"] {
  const out: NonNullable<ExportPptxRequest["branding"]> = {};
  if (primary.trim()) out.primary_color = primary.trim();
  if (secondary.trim()) out.secondary_color = secondary.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Some browsers require the anchor to be in the document for the
  // click to dispatch; remove it again immediately after.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke a tick later so the browser has a chance to start the
  // download before we yank the URL out from under it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
