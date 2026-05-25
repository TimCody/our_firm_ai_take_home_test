import Anthropic from "@anthropic-ai/sdk";
import type { PageRender, RegionResult } from "../types.js";
import { bufferToDataUrl, cropPng } from "./crop.js";
import { extractJsonObject } from "../lib/json-parse.js";

/**
 * Claude vision fallback for signature location.
 *
 * Model + scope discipline:
 *   - Uses Haiku 4.5 (the cheap+fast tier). This is a bbox-location task,
 *     not a reasoning task — Sonnet's extra cost buys nothing here.
 *   - Sends the ENTIRE last page (not a pre-cropped band). The whole point
 *     of the fallback is to catch cases geometry missed; constraining it to
 *     the same band geometry already failed in just narrows the blind spot.
 *   - We ask Claude for normalized [0..1] bbox coords and re-project to
 *     pixel coords on our side. Models are noticeably better at "0.3 down
 *     from the top" than at "y=487 pixels."
 *
 * If anything goes wrong (no key, API error, malformed response), we return
 * null so the caller keeps the deterministic result rather than 500ing.
 */
const AI_MODEL = "claude-haiku-4-5-20251001";

export async function aiLocateSignature(
  lastPage: PageRender,
): Promise<RegionResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: lastPage.pngBuffer.toString("base64"),
              },
            },
            {
              type: "text",
              text: [
                "This image is the last page of a document.",
                "Locate the handwritten or italic-rendered signature if one is present anywhere on the page.",
                "Signatures can appear at the bottom (most common), in initialed margins, or near a printed name elsewhere on the page.",
                "Respond with strict JSON only, no prose, no code fences:",
                '{ "present": boolean, "x": number, "y": number, "w": number, "h": number, "note": string }',
                "Coordinates are normalized to [0,1] relative to the image dimensions. (0,0) is top-left.",
                "x/y are the TOP-LEFT of the bbox; w/h are width and height.",
                'If no signature is present, return { "present": false, "x": 0, "y": 0, "w": 0, "h": 0, "note": "..." }.',
              ].join(" "),
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    const parsed = parseVisionResponse(textBlock.text);
    if (!parsed || !parsed.present) {
      return {
        kind: "signature",
        detected: false,
        imageDataUrl: null,
        confidence: 0.7,
        page: null,
        rationale: `Claude (Haiku) saw no signature on the last page. ${
          parsed?.note ?? ""
        }`.trim(),
        width: null,
        height: null,
      };
    }

    // Re-project normalized coords → full-page pixel coords.
    const boxX = Math.max(0, parsed.x * lastPage.width);
    const boxY = Math.max(0, parsed.y * lastPage.height);
    const boxW = Math.min(lastPage.width - boxX, parsed.w * lastPage.width);
    const boxH = Math.min(lastPage.height - boxY, parsed.h * lastPage.height);

    if (boxW < 10 || boxH < 10) return null;

    const { buffer, width, height } = await cropPng(
      lastPage.pngBuffer,
      { x: boxX, y: boxY, width: boxW, height: boxH },
      lastPage.width,
      lastPage.height,
    );

    return {
      kind: "signature",
      detected: true,
      imageDataUrl: bufferToDataUrl(buffer),
      confidence: 0.82,
      page: lastPage.pageIndex + 1,
      rationale: `AI vision (Claude Haiku) located the signature. ${parsed.note ?? ""}`.trim(),
      width,
      height,
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

interface VisionResponse {
  present: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  note?: string;
}

/**
 * Coerce Claude's vision JSON response into our typed shape.
 * Defers raw extraction to `extractJsonObject` (which tolerates code fences,
 * preambles, etc.) and then validates each field.
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
