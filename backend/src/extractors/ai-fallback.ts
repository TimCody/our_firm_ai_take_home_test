import Anthropic from "@anthropic-ai/sdk";
import type { PageRender, RegionKind, RegionResult } from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";
import { extractJsonObject } from "../lib/json-parse.js";

/**
 * Claude vision improvement step.
 *
 * One Bedrock call per "Improve with LLM" click. We send the last page
 * and ask Claude to locate all three regions in a single response.
 * That's roughly the same image-token cost as a signature-only call
 * but we get three verdicts back at once. For scanned/image-only PDFs
 * (no text layer), this is the difference between "all three not
 * detected" and "all three located."
 *
 * Cost discipline still applies:
 *   - Haiku 4.5, not Sonnet. This is a location task, not reasoning.
 *   - One image, one call. Letterhead is only meaningful when the
 *     page we sent IS the first page (single-page docs). The caller
 *     decides whether to apply that verdict based on pageCount.
 *
 * Failure modes (no API key, network error, malformed JSON) return
 * null so the caller keeps the deterministic result instead of 500ing.
 */
const AI_MODEL = "claude-haiku-4-5-20251001";

export interface AiRegionVerdicts {
  letterhead?: RegionResult;
  footer?: RegionResult;
  signature?: RegionResult;
}

// 60 seconds. The SDK's default timeout is ~10 minutes which is way
// too long for a UI-blocking call. We'd rather fail fast and let the
// user retry than leave the button stuck in "Calling Claude..."
const REQUEST_TIMEOUT_MS = 60_000;

export async function aiLocateRegions(
  page: PageRender,
): Promise<AiRegionVerdicts | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // eslint-disable-next-line no-console
  console.log(
    `[ai-fallback] calling ${AI_MODEL} for last page (${page.width}x${page.height})...`,
  );

  try {
    const client = new Anthropic({
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });

    const startedAt = Date.now();
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
    // eslint-disable-next-line no-console
    console.log(
      `[ai-fallback] response received in ${Date.now() - startedAt}ms`,
    );

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
    // We deliberately swallow this. If the AI call fails for any reason,
    // the deterministic result stays put and the request still succeeds.
    // We DO log everything we can about the error here so the dev can
    // diagnose. The SDK's default "Connection error." message hides the
    // underlying fetch failure, which lives on `err.cause`.
    logVisionCallFailure(err);
    return null;
  }
}

function logVisionCallFailure(err: unknown): void {
  /* eslint-disable no-console */
  console.warn("[ai-fallback] vision call failed, keeping deterministic result.");
  if (err instanceof Error) {
    console.warn("  message:", err.message);
    const anyErr = err as Error & {
      status?: number;
      cause?: unknown;
      headers?: Record<string, string>;
    };
    if (anyErr.status !== undefined) {
      console.warn("  HTTP status:", anyErr.status);
    }
    if (anyErr.headers?.["request-id"]) {
      console.warn("  request-id:", anyErr.headers["request-id"]);
    }
    if (anyErr.cause) {
      // The actual fetch/network error (DNS, TLS, ECONNREFUSED, etc.)
      // gets wrapped here. This is what's usually most useful.
      const cause = anyErr.cause;
      if (cause instanceof Error) {
        console.warn("  cause:", cause.message);
        const causeWithCode = cause as Error & { code?: string };
        if (causeWithCode.code) {
          console.warn("  cause.code:", causeWithCode.code);
        }
      } else {
        console.warn("  cause:", cause);
      }
    }
  } else {
    console.warn("  raw error:", err);
  }
  /* eslint-enable no-console */
}

function buildPrompt(): string {
  return [
    "This image is one page of a document.",
    "Locate each of the three regions below if present on this page.",
    "1. letterhead - branding/title block at the top (logo, company name, address, contact info).",
    "2. footer - small text at the bottom (page numbers, copyright, contact info, disclaimers).",
    "3. signature - handwritten or italic-rendered signature line. Can appear anywhere on the page.",
    "",
    "Respond with STRICT JSON ONLY (no prose, no code fences):",
    JSON.stringify({
      letterhead: { present: false, x: 0, y: 0, w: 0, h: 0, note: "" },
      footer: { present: false, x: 0, y: 0, w: 0, h: 0, note: "" },
      signature: { present: false, x: 0, y: 0, w: 0, h: 0, note: "" },
    }),
    "Coordinates are normalized to [0,1] relative to the image dimensions.",
    "(0,0) is the TOP-LEFT. x/y are the top-left corner of the bbox; w/h are width and height.",
    "If a region is not present, set present:false with all other fields zeroed.",
  ].join("\n");
}

/**
 * Build a RegionResult from one slice of the vision response.
 *
 * Two paths:
 *   - present=false: return a "not detected" result with Claude's
 *     confidence in the absence (0.7). The user sees that the AI
 *     ran and agreed there's nothing there.
 *   - present=true: re-project the normalized coords to pixels, crop
 *     the page, return the cropped image.
 */
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
      confidence: 0.7,
      page: null,
      rationale: `Claude (Haiku) saw no ${kind}.${v.note ? ` ${v.note}` : ""}`,
      width: null,
      height: null,
    };
  }

  // Project normalized [0,1] coords to absolute pixel coords. Clamp so
  // a slightly off-page bbox doesn't push us into a crop error.
  const boxX = Math.max(0, v.x * page.width);
  const boxY = Math.max(0, v.y * page.height);
  const boxW = Math.min(page.width - boxX, v.w * page.width);
  const boxH = Math.min(page.height - boxY, v.h * page.height);

  // A too-small bbox is almost always Claude hallucinating coords. Treat
  // it as a non-detection rather than a crop error.
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
 * Coerce Claude's three-region JSON response into typed verdicts.
 *
 * Each key is optional. If Claude omits a region (rare), we just leave
 * that region untouched on our side.
 *
 * Number coercion uses `Number(x) || 0` so a string like "0.5" becomes
 * 0.5 and a missing field becomes 0. Strings for `note` pass through;
 * any other type for `note` is dropped.
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
