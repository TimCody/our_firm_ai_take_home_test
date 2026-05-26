import Anthropic from "@anthropic-ai/sdk";
import type { PageRender, RegionKind, RegionResult } from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";
import { extractJsonObject } from "../lib/json-parse.js";

/**
 * Claude vision improvement step.
 *
 * One Bedrock call per "Improve with LLM" click. We send the last page and
 * ask Claude to locate all three regions in one response — that's roughly
 * the same image-token cost as a signature-only call but produces three
 * verdicts at once. For scanned/image-only PDFs (no text layer) this is
 * the difference between "all three not detected" and "all three located."
 *
 * Cost discipline still applies:
 *   - Haiku 4.5, not Sonnet — this is a location task, not reasoning.
 *   - One image, one call. Letterhead is only useful when the page we sent
 *     IS the first page (single-page docs) — caller decides whether to
 *     apply that verdict based on pageCount.
 *
 * Failure modes (no key, network, malformed JSON) return null so the
 * caller keeps the deterministic result rather than 500-ing.
 */
const AI_MODEL = "claude-haiku-4-5-20251001";

export interface AiRegionVerdicts {
  letterhead?: RegionResult;
  footer?: RegionResult;
  signature?: RegionResult;
}

export async function aiLocateRegions(
  page: PageRender,
): Promise<AiRegionVerdicts | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: page.pngBuffer.toString("base64"),
              },
            },
            { type: "text", text: buildPrompt() },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = parseAllRegionsResponse(textBlock.text);
    if (!parsed) return null;

    return {
      letterhead: parsed.letterhead
        ? await buildAiRegion(page, parsed.letterhead, "letterhead")
        : undefined,
      footer: parsed.footer
        ? await buildAiRegion(page, parsed.footer, "footer")
        : undefined,
      signature: parsed.signature
        ? await buildAiRegion(page, parsed.signature, "signature")
        : undefined,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[ai-fallback] vision call failed, keeping deterministic result:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function buildPrompt(): string {
  return [
    "This image is one page of a document.",
    "Locate each of the three regions below if present on this page.",
    "1. letterhead — branding/title block at the top (logo, company name, address, contact info).",
    "2. footer — small text at the bottom (page numbers, copyright, contact info, disclaimers).",
    "3. signature — handwritten or italic-rendered signature line. Can appear anywhere on the page.",
    "",
    "Respond with STRICT JSON ONLY (no prose, no code fences):",
    JSON.stringify({
      letterhead: { present: false, x: 0, y: 0, w: 0, h: 0, note: "" },
      footer: { present: false, x: 0, y: 0, w: 0, h: 0, note: "" },
      signature: { present: false, x: 0, y: 0, w: 0, h: 0, note: "" },
    }),
    "Coordinates are normalized to [0,1] relative to the image dimensions.",
    "(0,0) is TOP-LEFT. x/y are the TOP-LEFT corner of the bbox; w/h are width and height.",
    "If a region is not present, set present:false with all other fields zeroed.",
  ].join("\n");
}

async function buildAiRegion(
  page: PageRender,
  v: VisionResponse,
  kind: RegionKind,
): Promise<RegionResult> {
  if (!v.present) {
    return {
      kind,
      detected: false,
      imageDataUrl: null,
      confidence: 0.7, // confident absence per vision
      page: null,
      rationale: `Claude (Haiku) saw no ${kind}.${v.note ? ` ${v.note}` : ""}`,
      width: null,
      height: null,
    };
  }
  const boxX = Math.max(0, v.x * page.width);
  const boxY = Math.max(0, v.y * page.height);
  const boxW = Math.min(page.width - boxX, v.w * page.width);
  const boxH = Math.min(page.height - boxY, v.h * page.height);

  if (boxW < 10 || boxH < 10) {
    return {
      kind,
      detected: false,
      imageDataUrl: null,
      confidence: 0.5,
      page: null,
      rationale: `Claude returned an unusable ${kind} bbox.`,
      width: null,
      height: null,
    };
  }

  try {
    const { buffer, width, height } = await cropPng(
      page.pngBuffer,
      { x: boxX, y: boxY, width: boxW, height: boxH },
      page.width,
      page.height,
    );
    return {
      kind,
      detected: true,
      imageDataUrl: bufferToDataUrl(buffer),
      confidence: 0.82,
      page: page.pageIndex + 1,
      rationale: `AI vision (Claude Haiku) located the ${kind}.${v.note ? ` ${v.note}` : ""}`,
      width,
      height,
    };
  } catch (err) {
    return {
      kind,
      detected: false,
      imageDataUrl: null,
      confidence: 0,
      page: null,
      rationale: `AI ${kind} crop failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      width: null,
      height: null,
    };
  }
}

interface VisionResponse {
  present: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  note?: string;
}

/**
 * Coerce Claude's three-region JSON response into typed verdicts. Each key
 * is optional — if Claude omits one, we just leave that region untouched.
 */
export function parseAllRegionsResponse(text: string): {
  letterhead?: VisionResponse;
  footer?: VisionResponse;
  signature?: VisionResponse;
} | null {
  const obj = extractJsonObject<Record<string, unknown>>(text);
  if (!obj || typeof obj !== "object") return null;
  return {
    letterhead: parseRegion(obj.letterhead),
    footer: parseRegion(obj.footer),
    signature: parseRegion(obj.signature),
  };
}

function parseRegion(raw: unknown): VisionResponse | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    present: Boolean(r.present),
    x: Number(r.x) || 0,
    y: Number(r.y) || 0,
    w: Number(r.w) || 0,
    h: Number(r.h) || 0,
    note: typeof r.note === "string" ? r.note : undefined,
  };
}

/**
 * Kept for backwards compatibility with the older signature-only callers
 * and tests. New code should use `parseAllRegionsResponse`.
 */
export function parseVisionResponse(text: string): VisionResponse | null {
  const obj = extractJsonObject<Record<string, unknown>>(text);
  if (!obj || typeof obj !== "object") return null;
  return {
    present: Boolean(obj.present),
    x: Number(obj.x) || 0,
    y: Number(obj.y) || 0,
    w: Number(obj.w) || 0,
    h: Number(obj.h) || 0,
    note: typeof obj.note === "string" ? obj.note : undefined,
  };
}
