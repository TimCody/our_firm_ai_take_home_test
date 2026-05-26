/**
 * Magic-byte content sniffing.
 *
 * We accept the client's declared MIME type but verify against the
 * buffer's first few bytes. This protects against a few real-world
 * problems:
 *
 *   1. Renamed files (a .pdf that actually contains image bytes).
 *   2. Browsers that lie (some uploaders default to
 *      application/octet-stream).
 *   3. Edge cases where the MIME and the file extension disagree.
 */
export type DocumentKind = "pdf" | "docx" | "image" | "unknown";

export function sniffMime(buffer: Buffer, declaredMime: string): DocumentKind {
  // Need at least 4 bytes to check any of the known magic numbers.
  if (buffer.length < 4) return "unknown";

  if (hasPdfMagic(buffer)) return "pdf";
  if (hasDocxMagic(buffer, declaredMime)) return "docx";
  if (hasImageMagic(buffer, declaredMime)) return "image";

  return "unknown";
}

/** PDFs start with the literal bytes `%PDF-`. */
function hasPdfMagic(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  return (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 && // F
    buffer[4] === 0x2d // -
  );
}

/**
 * DOCX is a ZIP archive under the hood, so it starts with the bytes
 * `PK\x03\x04`. That's not enough on its own (every .zip starts the
 * same way), so we also require the declared MIME to contain
 * "wordprocessingml".
 */
function hasDocxMagic(buffer: Buffer, declaredMime: string): boolean {
  if (buffer.length < 4) return false;
  const isZip =
    buffer[0] === 0x50 && // P
    buffer[1] === 0x4b && // K
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  return isZip && declaredMime.includes("wordprocessingml");
}

/**
 * PNG: `\x89PNG`. JPEG: `\xFF\xD8\xFF`. If neither matches but the
 * declared MIME is `image/*`, we trust the MIME (handles formats we
 * don't have a magic-byte check for, like HEIC or AVIF).
 */
function hasImageMagic(buffer: Buffer, declaredMime: string): boolean {
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  if (isPng) return true;

  const isJpeg =
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) return true;

  // Trust an image/* MIME even if the magic bytes are unfamiliar.
  return declaredMime.startsWith("image/");
}
