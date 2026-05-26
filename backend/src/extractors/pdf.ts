import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PageRender, TextItem } from "../types.js";

/**
 * PDF rendering and text extraction via pdfjs-dist.
 *
 * We use the "legacy" build because the modern build assumes a worker
 * environment we don't have in Node. The legacy build runs the same
 * code on the main thread, which is fine for a backend extraction job.
 *
 * Lazy-loaded so that the heavy pdfjs module only gets parsed when we
 * actually need to read a PDF, not on every health-check request.
 */
let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
async function loadPdfjs() {
  if (pdfjsLib === null) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsLib;
}

/**
 * Locate the standard_fonts and cmaps directories that ship inside the
 * pdfjs-dist package.
 *
 * Without these paths, pdfjs in Node silently drops glyphs for the
 * standard 14 PDF fonts (Helvetica, Times, etc.). The text layer still
 * extracts correctly, but the rasterized page comes back missing its
 * text. Took an embarrassingly long time to figure that out the first
 * time we hit it, so it's documented here.
 */
let pdfjsAssetDirs: { fontsDir: string; cmapsDir: string } | null = null;
function resolvePdfjsAssets() {
  if (pdfjsAssetDirs !== null) return pdfjsAssetDirs;

  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve("pdfjs-dist/package.json");
  const root = dirname(pkgPath);

  // pdfjs expects trailing slashes on these paths.
  pdfjsAssetDirs = {
    fontsDir: join(root, "standard_fonts") + "/",
    cmapsDir: join(root, "cmaps") + "/",
  };
  return pdfjsAssetDirs;
}

export interface LoadedPdf {
  pageCount: number;
  /** Render a specific page to a PNG buffer + extract its text items. */
  renderPage(pageIndex: number, scale?: number): Promise<PageRender>;
}

export async function loadPdf(buffer: Buffer): Promise<LoadedPdf> {
  const pdfjs = await loadPdfjs();
  const { fontsDir, cmapsDir } = resolvePdfjsAssets();

  // pdfjs mutates the buffer it's given, so pass a fresh Uint8Array copy.
  const data = new Uint8Array(buffer);

  const doc = await pdfjs.getDocument({
    data,
    disableWorker: true,
    standardFontDataUrl: fontsDir,
    cMapUrl: cmapsDir,
    cMapPacked: true,
    verbosity: 0,
  }).promise;

  return {
    pageCount: doc.numPages,
    async renderPage(pageIndex, scale = 2): Promise<PageRender> {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext("2d");

      // @napi-rs/canvas's context is compatible with the subset that
      // pdfjs uses, but the type definitions disagree. Cast through
      // unknown to satisfy both.
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const pngBuffer = await canvas.encode("png");

      // Pull the text layer with bounding boxes and translate from
      // PDF native coordinates (bottom-left origin) to image
      // coordinates (top-left origin).
      const textContent = await page.getTextContent();
      const textItems: TextItem[] = [];

      for (const rawItem of textContent.items) {
        if (!("str" in rawItem)) continue;
        const item = rawItem as import("pdfjs-dist/types/src/display/api").TextItem;

        // PDF transform matrix is [a, b, c, d, e, f]. We need d (vertical
        // scale, which gives us font height) and e, f (the position).
        // Strict mode treats arr[n] as possibly undefined, hence the ??.
        const transform = item.transform;
        const d = transform[3] ?? 0;
        const e = transform[4] ?? 0;
        const f = transform[5] ?? 0;

        const x = e * scale;
        const yFromBottom = f * scale;
        const w = item.width * scale;
        const h = Math.abs(d) * scale;
        // Flip y from bottom-up (PDF) to top-down (image).
        const y = viewport.height - yFromBottom - h;

        const fontName =
          (item as { fontName?: string }).fontName ?? undefined;

        const textItem: TextItem = {
          str: item.str,
          x,
          y,
          width: w,
          height: h,
          fontName,
          italic: isItalicFont(fontName),
        };

        // Drop empty whitespace items unless they have width (which
        // means they're a real space character on the page).
        if (textItem.str.trim().length > 0 || textItem.width > 0) {
          textItems.push(textItem);
        }
      }

      return {
        pageIndex,
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        pngBuffer: Buffer.from(pngBuffer),
        textItems,
      };
    },
  };
}

/**
 * Heuristic for "is this font italic-like?" Used by the signature
 * extractor's italic-font path. The PDF spec doesn't have a clean
 * italic flag, but font names usually carry the cue.
 */
function isItalicFont(fontName: string | undefined): boolean {
  if (!fontName) return false;
  const lower = fontName.toLowerCase();
  return (
    lower.includes("italic") ||
    lower.includes("oblique") ||
    lower.includes("script") ||
    lower.includes("hand")
  );
}
