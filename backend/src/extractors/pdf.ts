import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PageRender, TextItem } from "../types.js";

// pdfjs-dist is ESM-only via subpath. The legacy build supports Node.
// We dynamically import so the heavy module only loads when needed.
let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;
async function loadPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsLib;
}

/**
 * Locate the standard_fonts / cmaps directories that ship inside the
 * pdfjs-dist package. Without these, pdfjs in Node silently drops glyphs
 * for the standard 14 PDF fonts (Helvetica, Times, etc.) — the text layer
 * still extracts correctly, but the rasterized page comes back missing
 * its text. Took me an embarrassingly long time to figure that out the
 * first time I hit it.
 */
let pdfjsAssetDirs: { fontsDir: string; cmapsDir: string } | null = null;
function resolvePdfjsAssets() {
  if (pdfjsAssetDirs) return pdfjsAssetDirs;
  const req = createRequire(import.meta.url);
  const pkg = req.resolve("pdfjs-dist/package.json");
  const root = dirname(pkg);
  pdfjsAssetDirs = {
    // Trailing slash required by pdfjs.
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
  // pdfjs mutates the buffer it's given — pass a fresh Uint8Array copy.
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

      await page.render({
        // @napi-rs/canvas's context is compatible with the subset
        // pdfjs uses, but the types disagree. Cast through unknown.
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const pngBuffer = await canvas.encode("png");

      const textContent = await page.getTextContent();
      const textItems: TextItem[] = textContent.items
        .filter(
          (item): item is import("pdfjs-dist/types/src/display/api").TextItem =>
            "str" in item,
        )
        .map((item) => {
          // PDF transform matrix [a, b, c, d, e, f]: e = x, f = y.
          // PDF origin is bottom-left; we flip to top-left for sanity.
          // Defensive defaults: pdfjs always returns 6-element matrices but
          // strict mode treats arr[n] as possibly-undefined.
          const transform = item.transform;
          const d = transform[3] ?? 0;
          const e = transform[4] ?? 0;
          const f = transform[5] ?? 0;
          const x = e * scale;
          const yFromBottom = f * scale;
          const w = item.width * scale;
          const h = Math.abs(d) * scale;
          const y = viewport.height - yFromBottom - h;
          const fontName =
            (item as { fontName?: string }).fontName ?? undefined;
          return {
            str: item.str,
            x,
            y,
            width: w,
            height: h,
            fontName,
            italic: isItalicFont(fontName),
          };
        })
        .filter((t) => t.str.trim().length > 0 || t.width > 0);

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
