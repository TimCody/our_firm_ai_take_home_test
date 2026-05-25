import { describe, expect, it } from "vitest";
import {
  findBySignOffToken,
  findByItalicFont,
  SIGN_OFF_TOKENS,
} from "../signature.js";
import type { PageRender, TextItem } from "../../types.js";

function makePage(textItems: TextItem[], height = 1000, width = 800): PageRender {
  return {
    pageIndex: 0,
    width,
    height,
    pngBuffer: Buffer.alloc(0), // not used by token/italic searches
    textItems,
  };
}

function item(
  str: string,
  x: number,
  y: number,
  opts: Partial<TextItem> = {},
): TextItem {
  return {
    str,
    x,
    y,
    width: opts.width ?? str.length * 7,
    height: opts.height ?? 12,
    fontName: opts.fontName,
    italic: opts.italic ?? false,
  };
}

describe("findBySignOffToken", () => {
  it("locates a 'Sincerely,' sign-off in the bottom half", () => {
    const page = makePage([
      item("Body text here.", 50, 100),
      item("Sincerely,", 50, 800),
      item("Eleanor Sterling", 50, 850),
    ]);
    const result = findBySignOffToken(page);
    expect(result).not.toBeNull();
    expect(result!.rationale).toContain("sincerely");
  });

  it("is case-insensitive", () => {
    const page = makePage([item("SINCERELY,", 50, 800)]);
    expect(findBySignOffToken(page)).not.toBeNull();
  });

  it("ignores sign-off tokens that appear in body text (top half)", () => {
    // "I sincerely apologize" in the body shouldn't trigger.
    const page = makePage([
      item("I sincerely apologize for the delay.", 50, 100),
    ]);
    expect(findBySignOffToken(page)).toBeNull();
  });

  it("returns null when no sign-off token is present", () => {
    const page = makePage([item("Body content only.", 50, 800)]);
    expect(findBySignOffToken(page)).toBeNull();
  });

  it("crops a region that starts at the sign-off line and extends below", () => {
    const page = makePage([item("Regards,", 50, 800)]);
    const result = findBySignOffToken(page)!;
    expect(result.box.y).toBeLessThanOrEqual(800);
    expect(result.box.y + result.box.height).toBeGreaterThan(800);
  });

  it("recognizes all configured sign-off tokens", () => {
    // Regression guard: if someone shortens the token list, this test catches it.
    for (const token of SIGN_OFF_TOKENS) {
      const page = makePage([item(`${token} placeholder`, 50, 800)]);
      expect(findBySignOffToken(page), `should match: "${token}"`).not.toBeNull();
    }
  });
});

describe("findByItalicFont", () => {
  it("locates an italic glyph run in the bottom half", () => {
    const page = makePage([
      item("Body", 50, 100, { italic: false }),
      item("Eleanor Sterling", 50, 850, { italic: true, fontName: "Helvetica-Oblique" }),
    ]);
    expect(findByItalicFont(page)).not.toBeNull();
  });

  it("ignores italic text in the top half (could be a heading)", () => {
    const page = makePage([
      item("Italic Title", 50, 100, { italic: true, fontName: "Times-Italic" }),
    ]);
    expect(findByItalicFont(page)).toBeNull();
  });

  it("returns null when no italic text exists", () => {
    const page = makePage([item("Plain text", 50, 850)]);
    expect(findByItalicFont(page)).toBeNull();
  });
});
