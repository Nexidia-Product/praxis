"use client";

/**
 * Off-screen renderer for raster export slides (Section 5.9).
 *
 * The export modal needs PNG captures of roadmap views — Timeline,
 * Kanban, and Bubble — so the API route can embed them in the deck.
 * The challenge is that the views render at the *current* viewport
 * size and reflect the *current* toolbar state (e.g. the granularity
 * dropdown on Timeline). We want exports to be:
 *
 *   - **Repeatable**: a user clicking Export with the same filters
 *     should get the same deck regardless of how the on-page Timeline
 *     was configured at the time.
 *   - **Independent**: capturing the Kanban view shouldn't require
 *     the Kanban tab to be active (and it shouldn't disturb the
 *     active tab as a side-effect).
 *   - **Wide**: charts get embedded at slide width (~12 inches), so
 *     capturing at viewport width and upscaling produces a blurry slide.
 *
 * Solution: mount the view inside a fixed-size container positioned
 * off-screen (`left: -10000px`, far enough left that it doesn't paint
 * a scrollbar), wait one animation frame for the React tree and the
 * useMemos inside it to settle, run html2canvas at the configured
 * device pixel ratio, then unmount.
 *
 * Limitations:
 *
 *   - Drag handlers and modal popovers inside the views are still
 *     wired but no-op against a no-op callback we pass in.
 *   - The captured DOM uses the same Tailwind-generated stylesheet as
 *     the on-screen tree, so styling stays consistent without any
 *     per-export theme switching.
 *   - html2canvas doesn't render `position: sticky` ancestors well;
 *     none of our views use sticky inside the body, so this isn't a
 *     concern in practice.
 */

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";

import { TimelineView } from "@/components/roadmap/timeline-view";
import { KanbanView } from "@/components/roadmap/kanban-view";
import { BubbleView } from "@/components/roadmap/bubble-view";
import type { RoadmapView } from "@/lib/roadmap/views";
import type {
  PortfolioQuadrantLabels,
  Project,
  SavedKanbanConfig,
} from "@/lib/db";
import type { SlideCapture } from "@/lib/export/payload";

/** Fixed render size. ~16:9, generous so charts have room to breathe. */
const RENDER_W = 1600;
const RENDER_H = 900;
/** html2canvas pixel scale (Section 5.9 calls for 2x for retina output). */
const RENDER_SCALE = 2;

/**
 * Capture-time inputs. The renderer takes the same project list the
 * on-screen view would have, plus saved Kanban configs and a no-op
 * callback set so the views render in their default state without
 * mutating anything.
 */
export interface CaptureInputs {
  projects: Project[];
  savedConfigs: SavedKanbanConfig[];
  /** Strategic-position labels for the Kanban card badge and bubble chart. */
  quadrantLabels: PortfolioQuadrantLabels;
}

/**
 * Capture a single raster view. Returns a `SlideCapture` (data URL +
 * dimensions) ready to slot into the API request payload.
 *
 * Throws if html2canvas can't be loaded — the caller should surface
 * that as a user-facing error rather than silently dropping slides.
 */
export async function captureRoadmapView(
  view: RoadmapView,
  inputs: CaptureInputs,
): Promise<SlideCapture> {
  if (typeof window === "undefined") {
    throw new Error("captureRoadmapView is only available in the browser.");
  }

  const html2canvasModule = await import("html2canvas");
  const html2canvas = html2canvasModule.default;

  // Build the off-screen host. We attach to `<body>` so all global
  // stylesheets cascade in correctly. `left: -10000px` removes it from
  // the visible scroll region without setting `display: none` (which
  // would break layout-dependent measurements like getBoundingClientRect
  // that some of the views rely on internally).
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "-10000px";
  host.style.width = `${RENDER_W}px`;
  host.style.height = `${RENDER_H}px`;
  host.style.overflow = "hidden";
  host.style.background = "#ffffff";
  host.style.pointerEvents = "none";
  // Hint to ARIA / screenreaders that this temporary tree is decorative.
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  let root: Root | null = null;

  try {
    root = createRoot(host);

    // Render the view inside a wrapper that gives it the white
    // background and padding the on-page version gets from the parent.
    flushSync(() => {
      root!.render(
        <div
          style={{
            width: `${RENDER_W}px`,
            height: `${RENDER_H}px`,
            background: "#ffffff",
            padding: "16px",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          {renderView(view, inputs)}
        </div>,
      );
    });

    // Wait two animation frames: the first commits the DOM, the second
    // gives any useEffects (e.g. stable measurement of computed widths)
    // a chance to run before we measure pixels. Two frames is overkill
    // for most views but cheap insurance — capture without it occasionally
    // misses last-tick layout work.
    await nextFrame();
    await nextFrame();

    const canvas = await html2canvas(host, {
      backgroundColor: "#ffffff",
      scale: RENDER_SCALE,
      useCORS: true,
      logging: false,
      width: RENDER_W,
      height: RENDER_H,
      // html2canvas measures the document size by default; pin to our
      // host dimensions so the output is exactly RENDER_W × RENDER_H
      // even if the inner tree paints into a slightly larger box.
      windowWidth: RENDER_W,
      windowHeight: RENDER_H,
    });

    const dataUrl = canvas.toDataURL("image/png");
    return {
      data_url: dataUrl,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    // Always tear down. If `root` was created but `render` threw, the
    // unmount is still safe; if `root` is null we just remove the host.
    if (root) {
      try {
        root.unmount();
      } catch {
        // unmount during teardown can throw on already-detached roots;
        // the host removal below handles cleanup either way.
      }
    }
    if (host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

/**
 * No-op write callbacks used by the off-screen views. The views accept
 * these as props so drag and click handlers wire up; we hand them
 * stubs because nothing the user does in the off-screen tree should
 * mutate state.
 */
const noopUpdateField = async (): Promise<void> => {
  /* off-screen capture — write callbacks are inert */
};
const noopUpdateTargetDate = async (): Promise<void> => {
  /* off-screen capture — write callbacks are inert */
};
const noopOpenQuickView = (): void => {
  /* off-screen capture — quick view is suppressed */
};
const noopSaveConfig = async (): Promise<never> => {
  throw new Error("save not available off-screen");
};
const noopDeleteConfig = async (): Promise<void> => {
  /* off-screen capture — delete is inert */
};

function renderView(view: RoadmapView, inputs: CaptureInputs) {
  switch (view) {
    case "timeline":
      return (
        <TimelineView
          projects={inputs.projects}
          onUpdateTargetDate={noopUpdateTargetDate}
          onOpenQuickView={noopOpenQuickView}
          canEdit={false}
        />
      );
    case "kanban":
      return (
        <KanbanView
          projects={inputs.projects}
          savedConfigs={inputs.savedConfigs}
          onUpdateField={noopUpdateField}
          onSaveConfig={noopSaveConfig}
          onDeleteConfig={noopDeleteConfig}
          onOpenQuickView={noopOpenQuickView}
          canEdit={false}
          quadrantLabels={inputs.quadrantLabels}
        />
      );
    case "bubble":
      return (
        <BubbleView
          projects={inputs.projects}
          onUpdateField={noopUpdateField}
          onOpenQuickView={noopOpenQuickView}
          canEdit={false}
          quadrantLabels={inputs.quadrantLabels}
        />
      );
    case "now-next-later":
      // Not a raster slide — handled natively by the API route. We
      // include the case for exhaustiveness in case the catalog
      // changes; returning null is harmless.
      return null;
    default: {
      // Type-level exhaustiveness check.
      const _never: never = view;
      void _never;
      return null;
    }
  }
}
