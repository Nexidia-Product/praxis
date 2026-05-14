/**
 * Smoke test for the PPTX template-branding pipeline. Loads the
 * template at data/branding/template.pptx, parses its theme, and
 * generates a small deck so we can eyeball the result.
 *
 *   npm run smoke:template
 *
 * Output: /tmp/iim-smoke-template.pptx
 */
import fs from "node:fs";
import {
  loadTemplateBranding,
  _resetTemplateCacheForTests,
} from "../lib/export/template";
import {
  addTitleSlide,
  addNowNextLaterSlide,
  addProjectsStatusSlide,
} from "../lib/export/slide-builders";

async function main() {
  _resetTemplateCacheForTests();

  const settingsBranding = {
    primary_color: "#000000",
    secondary_color: "#FF00FF",
    font: "Times New Roman",
    logo_url: null,
  };

  const branding = await loadTemplateBranding(settingsBranding);
  console.log("Resolved branding:");
  console.log("  primaryHex    =", branding.primaryHex);
  console.log("  secondaryHex  =", branding.secondaryHex);
  console.log("  fontFace      =", branding.fontFace);
  console.log(
    "  coverImage?   =",
    branding.coverImageDataUrl ? "yes" : "no",
  );
  console.log(
    "  contentImage? =",
    branding.contentImageDataUrl ? "yes" : "no",
  );

  const PptxGenJSModule = await import("pptxgenjs");
  const PptxGenJS =
    (PptxGenJSModule as unknown as { default: typeof PptxGenJSModule.default })
      .default ?? PptxGenJSModule;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = "Smoke deck";

  addTitleSlide(pptx, branding, {
    title: "IIM Roadmap Review",
    subtitle: "Q2 2026 portfolio update",
    coverImageDataUrl: branding.coverImageDataUrl,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const project: any = {
    project_id: "2026-001",
    name: "Network Drive integration",
    application_product: "IIM",
    project_type: "Enhancement",
    priority: "High",
    status: "In Progress",
    phase: "Planning",
    project_lead: "user-1",
    primary_stakeholders: [],
    additional_resources: [],
    target_date: "2026-06-30",
    roadmap_bucket: "Now",
    health_score: "Green",
    health_score_history: [],
    document_links: [],
    custom_fields: {},
    description: "",
    date_added: "2026-04-01",
    created_by: "user-1",
    updated_at: "2026-04-01T00:00:00Z",
    depends_on: [],
    dependencies: [],
    status_history: [],
  };
  addNowNextLaterSlide(pptx, branding, [project]);
  addProjectsStatusSlide(pptx, branding, [project]);

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const path = "/tmp/iim-smoke-template.pptx";
  fs.writeFileSync(path, out);
  console.log(`\nWrote ${path} (${out.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
