import { describe, expect, it } from "vitest";
import { classifyError, formatBytes } from "../error-classifier.js";

const MAX = 25 * 1024 * 1024;

/**
 * Build an Error with a custom `name` or `code`. Those are the two
 * discriminators pdfjs and multer use respectively.
 */
function makeError(opts: { name?: string; code?: string; message?: string }): Error {
  const e = new Error(opts.message ?? "");
  if (opts.name) e.name = opts.name;
  if (opts.code) (e as Error & { code?: string }).code = opts.code;
  return e;
}

describe("classifyError", () => {
  describe("multer upload errors", () => {
    it("maps LIMIT_FILE_SIZE → 413 with a human-friendly size", () => {
      const v = classifyError(makeError({ code: "LIMIT_FILE_SIZE" }), MAX);
      expect(v.status).toBe(413);
      expect(v.message).toContain("25MB");
    });

    it("maps other LIMIT_* codes → 400", () => {
      const v = classifyError(
        makeError({ code: "LIMIT_PART_COUNT", message: "Too many parts" }),
        MAX,
      );
      expect(v.status).toBe(400);
    });
  });

  describe("empty file", () => {
    it("→ 400 when extractor reports empty buffer", () => {
      const v = classifyError(
        makeError({ message: "Uploaded file is empty." }),
        MAX,
      );
      expect(v.status).toBe(400);
    });
  });

  describe("unsupported file type", () => {
    it("→ 415 when our extractor rejects the MIME", () => {
      const v = classifyError(
        makeError({
          message: "Unsupported file type: application/zip. Supported: PDF, DOCX, PNG/JPEG.",
        }),
        MAX,
      );
      expect(v.status).toBe(415);
    });
  });

  describe("PDF errors", () => {
    it("matches pdfjs PasswordException by class name", () => {
      const v = classifyError(
        makeError({ name: "PasswordException", message: "PDF needs password" }),
        MAX,
      );
      expect(v.status).toBe(422);
      expect(v.message).toMatch(/password/i);
    });

    it("matches pdfjs InvalidPDFException by class name even if msg is opaque", () => {
      const v = classifyError(
        makeError({ name: "InvalidPDFException", message: "..." }),
        MAX,
      );
      expect(v.status).toBe(422);
      expect(v.message).toMatch(/corrupt|unparseable/);
    });

    it("matches by message text when class name is generic", () => {
      const v = classifyError(makeError({ message: "Invalid PDF structure" }), MAX);
      expect(v.status).toBe(422);
    });

    it("matches xref errors (a common pdfjs corruption symptom)", () => {
      const v = classifyError(
        makeError({ message: "Bad xref table at offset 12345" }),
        MAX,
      );
      expect(v.status).toBe(422);
    });
  });

  describe("DOCX errors", () => {
    it("matches JSZip 'end of central directory' (corrupt docx)", () => {
      // The brief specifically calls out "corrupt documents". For DOCX,
      // mammoth wraps JSZip which throws this exact message.
      const v = classifyError(
        makeError({
          message:
            "Can't find end of central directory : is this a zip file ?",
        }),
        MAX,
      );
      expect(v.status).toBe(422);
      expect(v.message).toMatch(/docx/i);
    });
  });

  describe("image errors", () => {
    it("matches sharp 'input file is missing' on corrupt image", () => {
      const v = classifyError(
        makeError({ message: "Input file is missing or has unsupported format" }),
        MAX,
      );
      expect(v.status).toBe(422);
      expect(v.message).toMatch(/image/i);
    });

    it("matches our own dimensions check", () => {
      const v = classifyError(
        makeError({ message: "Could not determine image dimensions." }),
        MAX,
      );
      expect(v.status).toBe(422);
    });
  });

  describe("unknown errors", () => {
    it("→ 500 for unrecognized errors (the central handler then logs)", () => {
      const v = classifyError(makeError({ message: "kernel exploded" }), MAX);
      expect(v.status).toBe(500);
    });

    it("→ 500 when given a non-Error value", () => {
      const v = classifyError("not an error", MAX);
      expect(v.status).toBe(500);
    });
  });
});

describe("formatBytes", () => {
  it("formats megabytes", () => {
    expect(formatBytes(25 * 1024 * 1024)).toBe("25MB");
  });
  it("formats kilobytes", () => {
    expect(formatBytes(500 * 1024)).toBe("500KB");
  });
  it("formats bytes", () => {
    expect(formatBytes(42)).toBe("42B");
  });
});
