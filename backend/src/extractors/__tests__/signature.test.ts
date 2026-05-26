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
  it("locates a 'Sincerely,' sign-off near the bottom of the page", () => {
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

  it("finds a sign-off in the upper-middle of a short letter", () => {
    // Short letters often place the sign-off at ~30-50% down the page.
    // The earlier "bottom half only" filter caused us to miss these.
    const page = makePage([
      item("Body text here.", 50, 100),
      item("Warmly,", 50, 300),
      item("Priya Subramanian", 50, 350),
    ]);
    const result = findBySignOffToken(page);
    expect(result).not.toBeNull();
    expect(result!.rationale.toLowerCase()).toContain("warmly");
  });

  it("picks the LAST sign-off when multiple short matches appear", () => {
    // Body line "regards from the team" is short enough to slip past the
    // length filter, but the real sign-off "Sincerely," lives further down.
    // We must pick the later one.
    const page = makePage([
      item("regards from the team", 50, 200),
      item("Sincerely,", 50, 800),
    ]);
    const result = findBySignOffToken(page)!;
    expect(result.box.y).toBeGreaterThan(700);
  });

  it("ignores long body lines that happen to contain sign-off words", () => {
    // "I sincerely apologize for the delay." is 36 chars — well over our
    // 30-char sign-off-line-length filter. Real sign-offs are short.
    const page = makePage([
      item("I sincerely apologize for the delay.", 50, 800),
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
      const page = makePage([item(`${token} x`, 50, 800)]);
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
