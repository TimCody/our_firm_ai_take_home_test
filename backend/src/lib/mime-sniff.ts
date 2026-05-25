/**
 * Magic-byte content sniffing.
 *
 * We accept the client's declared MIME type but verify against the buffer's
 * first few bytes. This protects against:
 *   - Renamed files (.pdf with image bytes)
 *   - Browsers that lie (some uploaders default to application/octet-stream)
 *   - Edge cases where MIME and extension disagree
 */
export type DocumentKind = "pdf" | "docx" | "image" | "unknown";

export function sniffMime(buffer: Buffer, declaredMime: string): DocumentKind {
  if (buffer.length < 4) return "unknown";

  if (hasPdfMagic(buffer)) return "pdf";
  if (hasDocxMagic(buffer, declaredMime)) return "docx";
  if (hasImageMagic(buffer, declaredMime)) return "image";

  return "unknown";
}

function hasPdfMagic(buffer: Buffer): boolean {
  // %PDF-
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}

function hasDocxMagic(buffer: Buffer, declaredMime: string): boolean {
  // DOCX is a zip (PK\x03\x04). Many archive formats share that magic, so
  // we also require the declared MIME to contain "wordprocessingml".
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04 &&
    declaredMime.includes("wordprocessingml")
  );
}

function hasImageMagic(buffer: Buffer, declaredMime: string): boolean {
  // PNG: \x89PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  // JPEG: \xFF\xD8\xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // Declared image/*  but unknown header: still trust it.
  return declaredMime.startsWith("image/");
}
