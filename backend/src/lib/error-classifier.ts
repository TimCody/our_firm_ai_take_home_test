/**
 * Maps any thrown error to an HTTP status + user-facing message.
 *
 * Pure function — takes an error in, returns a verdict. Keeps the route
 * handler short and makes every error path testable without spinning up
 * Express. The brief calls out "unsupported files, corrupt documents" as
 * specific cases the system has to handle gracefully; this is where each
 * library's failure modes get translated into something users can act on.
 *
 * Layout (matched in this order):
 *   1. Multer upload-layer errors (file too big, bad form)
 *   2. Empty file
 *   3. Our own throws ("Unsupported file type", "dimensions")
 *   4. pdfjs errors (by class name first, then message regex)
 *   5. mammoth (DOCX) errors
 *   6. sharp (image) errors
 *   7. Fallback → 500 with the raw message
 */

export interface ErrorVerdict {
  status: number;
  message: string;
}

/**
 * Minimal multer-error shape — avoids importing multer's types just to read
 * the discriminating `code` field at runtime.
 */
interface MulterLikeError {
  name?: string;
  code?: string;
  message?: string;
}

export function classifyError(err: unknown, maxBytes: number): ErrorVerdict {
  if (!(err instanceof Error)) {
    return { status: 500, message: "Unknown server error." };
  }

  const multerCode = (err as MulterLikeError).code;
  if (multerCode === "LIMIT_FILE_SIZE") {
    return {
      status: 413,
      message: `File exceeds the ${formatBytes(maxBytes)} limit.`,
    };
  }
  if (typeof multerCode === "string" && multerCode.startsWith("LIMIT_")) {
    return { status: 400, message: `Upload rejected: ${err.message}` };
  }

  const msg = err.message ?? "";
  const lower = msg.toLowerCase();

  if (lower.includes("uploaded file is empty")) {
    return { status: 400, message: "Uploaded file is empty." };
  }

  if (msg.startsWith("Unsupported file type")) {
    return { status: 415, message: msg };
  }

  if (lower.includes("could not determine image dimensions")) {
    return {
      status: 422,
      message: "The uploaded image is corrupt or unsupported.",
    };
  }

  // pdfjs errors — class names are stable across versions.
  if (err.name === "PasswordException" || lower.includes("password")) {
    return {
      status: 422,
      message: "Password-protected PDFs are not supported.",
    };
  }
  if (
    err.name === "InvalidPDFException" ||
    err.name === "MissingPDFException" ||
    /invalid pdf|corrupt pdf|missing pdf|xref/i.test(msg)
  ) {
    return {
      status: 422,
      message: "The PDF appears to be corrupt or unparseable.",
    };
  }

  // mammoth throws JSZip errors on bad DOCX (the format is a zip).
  if (
    /end of central directory|can't find end of central directory|not a (?:valid )?zip/i.test(
      msg,
    )
  ) {
    return {
      status: 422,
      message: "The DOCX appears to be corrupt or unparseable.",
    };
  }

  // sharp errors on unsupported / truncated images.
  if (
    /input file.+(missing|unsupported|truncated)|unsupported image format|vips_image_pio_input/i.test(
      msg,
    )
  ) {
    return {
      status: 422,
      message: "The image is corrupt or in an unsupported format.",
    };
  }

  return { status: 500, message: msg || "Unknown server error." };
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}
