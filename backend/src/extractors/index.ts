import { randomUUID } from "node:crypto";
import { loadPdf } from "./pdf.js";
import { extractLetterhead } from "./letterhead.js";
import { extractFooter } from "./footer.js";
import {
  extractSignature,
  SIGNATURE_AI_FALLBACK_THRESHOLD,
} from "./signature.js";
import { aiLocateSignature } from "./ai-fallback.js";
import { extractFromDocx } from "./docx.js";
import { extractFromImage } from "./image.js";
import { bufferToDataUrl } from "./crop.js";
import { sniffMime } from "../lib/mime-sniff.js";
import { estimateVisionCost } from "../lib/cost-estimator.js";
import type {
  AiCostEstimate,
  ExtractionResult,
  PageRender,
  RegionResult,
} from "../types.js";

/**
 * AI fallback policy. The default changed from "auto" to "off" — we now
 * never call the AI implicitly. The frontend's "Improve with LLM" button
 * sets `on` explicitly after showing the cost preview.
 */
export type AiMode = "off" | "auto" | "on";

export interface ExtractOptions {
  ai?: AiMode;
}

export async function extractDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  if (buffer.length === 0) {
    throw new Error("Uploaded file is empty.");
  }
  const kind = sniffMime(buffer, mimeType);

  if (kind === "pdf") return extractFromPdf(buffer, fileName, options);
  if (kind === "docx") return extractFromDocx(buffer, fileName);
  if (kind === "image") return extractFromImage(buffer, fileName, mimeType);

  throw new Error(
    `Unsupported file type: ${mimeType}. Supported: PDF, DOCX, PNG/JPEG.`,
  );
}

async function extractFromPdf(
  buffer: Buffer,
  fileName: string,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const aiMode = options.ai ?? "off";
  const pdf = await loadPdf(buffer);
  const pageCount = pdf.pageCount;
  const warnings: string[] = [];

  const firstPage = await pdf.renderPage(0, 2);
  const lastPage =
    pageCount === 1 ? firstPage : await pdf.renderPage(pageCount - 1, 2);

  const middleSample = await renderMiddleSample(pdf, pageCount);

  const letterhead = await extractLetterhead(firstPage);
  const footer = await extractFooter(lastPage, {
    allPages: middleSample
      ? [firstPage, middleSample, lastPage]
      : [firstPage, lastPage],
  });

  let signature: RegionResult = await extractSignature(lastPage);
  let usedAiFallback = false;
  if (shouldRunAi(aiMode, signature.confidence)) {
    const aiResult = await aiLocateSignature(lastPage);
    if (aiResult) {
      // The fact that AI ran is itself useful UX information — flip the
      // flag whenever we got an AI verdict back, not only when we adopted
      // it. This is what makes the "AI" badge appear and gives the user
      // visible feedback that their click did something.
      usedAiFallback = true;

      if (shouldPreferAi(signature, aiResult)) {
        signature = aiResult;
      } else {
        // AI was consulted and agreed (or was equal/lower confidence).
        // Annotate the rationale so the user sees that something changed.
        signature = {
          ...signature,
          rationale: appendAiAgreement(signature, aiResult),
        };
      }
    }
  }

  const pagePreviews = await renderPreviews(pdf, {
    pageCount,
    firstPage,
    lastPage,
    warnings,
  });

  return {
    documentId: randomUUID(),
    fileName,
    mimeType: "application/pdf",
    pageCount,
    pagePreviews,
    regions: { letterhead, footer, signature },
    usedAiFallback,
    aiCostEstimate: buildCostEstimate(lastPage),
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    warnings,
  };
}

function shouldRunAi(mode: AiMode, deterministicConfidence: number): boolean {
  if (mode === "off") return false;
  if (mode === "on") return true;
  return deterministicConfidence < SIGNATURE_AI_FALLBACK_THRESHOLD;
}

function shouldPreferAi(
  deterministic: RegionResult,
  ai: RegionResult,
): boolean {
  // AI found something we missed — always prefer.
  if (!deterministic.detected && ai.detected) return true;
  // AI located the same region with higher confidence — prefer.
  if (ai.detected && ai.confidence > deterministic.confidence) return true;
  // Both agree there's no signature, but AI is more confident in the
  // absence verdict. Adopt AI's rationale so the user sees vision was
  // consulted (e.g. "Claude saw no signature on the last page").
  if (
    !deterministic.detected &&
    !ai.detected &&
    ai.confidence > deterministic.confidence
  ) {
    return true;
  }
  return false;
}

/**
 * When AI was consulted but we kept the deterministic crop, append a
 * one-liner to the rationale so the user sees that AI actually ran.
 */
function appendAiAgreement(
  deterministic: RegionResult,
  ai: RegionResult,
): string {
  const verdict = ai.detected
    ? `agreed a signature is present (Claude conf ${(ai.confidence * 100).toFixed(0)}%)`
    : `also found no signature (Claude conf ${(ai.confidence * 100).toFixed(0)}%)`;
  return `${deterministic.rationale} · Claude vision (Haiku) ${verdict}.`;
}

async function renderMiddleSample(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageCount: number,
): Promise<PageRender | null> {
  if (pageCount < 3) return null;
  try {
    return await pdf.renderPage(Math.floor(pageCount / 2), 1);
  } catch {
    return null;
  }
}

async function renderPreviews(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  ctx: {
    pageCount: number;
    firstPage: PageRender;
    lastPage: PageRender;
    warnings: string[];
  },
): Promise<string[]> {
  const limit = Math.min(ctx.pageCount, 8);
  const previews: string[] = [];
  for (let i = 0; i < limit; i++) {
    let rendered: PageRender;
    if (i === 0) rendered = ctx.firstPage;
    else if (i === ctx.pageCount - 1 && ctx.pageCount > 1) rendered = ctx.lastPage;
    else rendered = await pdf.renderPage(i, 0.6);
    previews.push(bufferToDataUrl(rendered.pngBuffer));
  }
  if (ctx.pageCount > limit) {
    ctx.warnings.push(
      `Document has ${ctx.pageCount} pages; preview thumbnails truncated to ${limit}.`,
    );
  }
  return previews;
}

function buildCostEstimate(lastPage: PageRender): AiCostEstimate {
  const e = estimateVisionCost({
    imageWidth: lastPage.width,
    imageHeight: lastPage.height,
    promptTokens: 200,
    maxOutputTokens: 256,
    model: "haiku",
  });
  return {
    model: e.model,
    imageTokens: e.imageTokens,
    promptTokens: e.promptTokens,
    maxOutputTokens: e.maxOutputTokens,
    estimatedUsd: e.estimatedUsd,
    pretty: e.pretty,
  };
}
