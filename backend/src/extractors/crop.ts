import sharp from "sharp";
import type { BoundingBox } from "../types.js";

/**
 * Crop a PNG buffer to a bounding box.
 *
 * Clamps the box to the image dimensions so heuristics that overshoot
 * the page edge don't throw. Returns the cropped buffer + its actual
 * dimensions (which may be smaller than what was requested if the box
 * was clamped).
 */
export async function cropPng(
  png: Buffer,
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const width = Math.min(Math.ceil(box.width), imageWidth - left);
  const height = Math.min(Math.ceil(box.height), imageHeight - top);

  if (width <= 0 || height <= 0) {
    throw new Error(
      `cropPng: invalid box ${JSON.stringify({ left, top, width, height })}`,
    );
  }

  const buffer = await sharp(png)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();

  return { buffer, width, height };
}

export function bufferToDataUrl(buf: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}
