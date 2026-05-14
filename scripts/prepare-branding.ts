/**
 * Pre-render branding images from data/branding/template.pptx.
 *
 * The PPTX export uses two PNGs as full-bleed backgrounds:
 *
 *   - data/branding/cover.png    — title slide background
 *   - data/branding/content.png  — content slide background (with brand
 *                                  mark and slide number)
 *
 * They're generated *once* per template swap so the runtime export route
 * doesn't need libreoffice on the deploy host. Run this when you replace
 * data/branding/template.pptx:
 *
 *   npm run prepare:branding
 *
 * The script:
 *   1. Confirms libreoffice is on PATH.
 *   2. Converts the template to PDF with `libreoffice --headless`.
 *   3. Extracts page 1 (cover layout) and page 5 (basic content layout)
 *      using `pdftoppm` and writes them to public/branding/.
 *
 * Page numbers are based on the layout order in the supplied NiCE
 * template (NiCE-2026_basic_template.pptx). If a future template
 * reorders its layouts, override with environment variables:
 *
 *   PRAXIS_BRANDING_COVER_PAGE=1 PRAXIS_BRANDING_CONTENT_PAGE=5 npm run prepare:branding
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BRANDING_DIR = path.join(process.cwd(), "public", "branding");
const TEMPLATE_PATH = path.join(BRANDING_DIR, "template.pptx");
const COVER_PAGE = Number(process.env.PRAXIS_BRANDING_COVER_PAGE ?? "1");
const CONTENT_PAGE = Number(process.env.PRAXIS_BRANDING_CONTENT_PAGE ?? "5");

function fail(msg: string): never {
  console.error(`[prepare:branding] ${msg}`);
  process.exit(1);
}

function ensureCommand(cmd: string): void {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
  } catch {
    fail(
      `Required command "${cmd}" not found on PATH. Install LibreOffice (provides ${cmd} and pdftoppm) and re-run.`,
    );
  }
}

function main(): void {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    fail(
      `Template not found at ${TEMPLATE_PATH}. Drop your branded template in data/branding/template.pptx.`,
    );
  }

  ensureCommand("libreoffice");
  ensureCommand("pdftoppm");

  // Use a unique scratch dir so concurrent runs don't clobber each other.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iim-branding-"));
  console.log(`[prepare:branding] Working in ${tmpDir}`);

  // 1. Convert template to PDF.
  console.log("[prepare:branding] Rendering template → PDF via LibreOffice…");
  execFileSync(
    "libreoffice",
    ["--headless", "--convert-to", "pdf", "--outdir", tmpDir, TEMPLATE_PATH],
    { stdio: "inherit" },
  );

  const pdfPath = path.join(
    tmpDir,
    path.basename(TEMPLATE_PATH).replace(/\.pptx$/i, ".pdf"),
  );
  if (!fs.existsSync(pdfPath)) {
    fail(`Expected PDF at ${pdfPath} but none was produced.`);
  }

  // 2. Render the chosen layout pages to PNG. We render at 150 DPI; the
  //    images get embedded as full-bleed backgrounds, and 150 DPI on a
  //    13.33" wide slide produces a ~2000-pixel image — sharp without
  //    bloating the deck.
  console.log("[prepare:branding] Rasterizing pages → PNG…");
  const pngBase = path.join(tmpDir, "tpl-page");
  execFileSync("pdftoppm", ["-png", "-r", "150", pdfPath, pngBase], {
    stdio: "inherit",
  });

  const pad = (n: number) => String(n).padStart(2, "0");
  const coverSrc = `${pngBase}-${pad(COVER_PAGE)}.png`;
  const contentSrc = `${pngBase}-${pad(CONTENT_PAGE)}.png`;

  if (!fs.existsSync(coverSrc)) {
    fail(
      `Expected cover at ${coverSrc} (page ${COVER_PAGE}) — does the template have at least ${COVER_PAGE} layouts?`,
    );
  }
  if (!fs.existsSync(contentSrc)) {
    fail(
      `Expected content background at ${contentSrc} (page ${CONTENT_PAGE}).`,
    );
  }

  // 3. Copy results into data/branding.
  fs.copyFileSync(coverSrc, path.join(BRANDING_DIR, "cover.png"));
  fs.copyFileSync(contentSrc, path.join(BRANDING_DIR, "content.png"));

  // 4. Tidy up.
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const stat = (p: string) => fs.statSync(p).size;
  console.log("[prepare:branding] Done.");
  console.log(
    `  cover.png   ${stat(path.join(BRANDING_DIR, "cover.png"))} bytes`,
  );
  console.log(
    `  content.png ${stat(path.join(BRANDING_DIR, "content.png"))} bytes`,
  );
}

main();
