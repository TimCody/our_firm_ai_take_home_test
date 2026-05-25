import { describe, expect, it } from "vitest";
import { sniffMime } from "../mime-sniff.js";

function buf(...bytes: number[]): Buffer {
  return Buffer.from(bytes);
}

describe("sniffMime", () => {
  it("detects a PDF by its %PDF- magic", () => {
    const b = buf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
    expect(sniffMime(b, "application/pdf")).toBe("pdf");
  });

  it("detects PDF even if the declared MIME lies", () => {
    // Important: someone uploading PDF bytes with mimetype application/octet-stream
    // should still be routed to the PDF path.
    const b = buf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
    expect(sniffMime(b, "application/octet-stream")).toBe("pdf");
  });

  it("detects PNG by magic regardless of declared MIME", () => {
    const b = buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(sniffMime(b, "application/octet-stream")).toBe("image");
  });

  it("detects JPEG by magic", () => {
    const b = buf(0xff, 0xd8, 0xff, 0xe0);
    expect(sniffMime(b, "")).toBe("image");
  });

  it("requires both zip magic AND wordprocessingml MIME for DOCX", () => {
    const zipBytes = buf(0x50, 0x4b, 0x03, 0x04);
    // Plain zip without DOCX MIME → unknown
    expect(sniffMime(zipBytes, "application/zip")).toBe("unknown");
    // With the DOCX MIME → docx
    expect(
      sniffMime(
        zipBytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("docx");
  });

  it("trusts image/* MIME even with unknown header bytes", () => {
    // Some uncommon image format we don't recognize by magic.
    const b = buf(0x00, 0x01, 0x02, 0x03);
    expect(sniffMime(b, "image/heic")).toBe("image");
  });

  it("returns unknown for short buffers", () => {
    expect(sniffMime(buf(0x25), "application/pdf")).toBe("unknown");
  });

  it("returns unknown for genuinely unidentifiable content", () => {
    const b = buf(0x00, 0x01, 0x02, 0x03);
    expect(sniffMime(b, "application/octet-stream")).toBe("unknown");
  });
});
