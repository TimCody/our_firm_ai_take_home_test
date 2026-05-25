import { describe, expect, it } from "vitest";
import { scoreLetterhead } from "../letterhead.js";
import type { TextItem } from "../../types.js";

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

describe("scoreLetterhead", () => {
  it("returns a low score for an empty cluster", () => {
    expect(scoreLetterhead([], 800)).toBeLessThan(0.5);
  });

  it("bumps score for URL-like text", () => {
    const plain = scoreLetterhead([item("Acme", 0, 0)], 800);
    const withUrl = scoreLetterhead(
      [item("Acme · www.acme.com", 0, 0)],
      800,
    );
    expect(withUrl).toBeGreaterThan(plain);
  });

  it("bumps score for phone numbers", () => {
    const plain = scoreLetterhead([item("Acme", 0, 0)], 800);
    const withPhone = scoreLetterhead(
      [item("Acme · (415) 555-0123", 0, 0)],
      800,
    );
    expect(withPhone).toBeGreaterThan(plain);
  });

  it("bumps score for company suffixes (Inc, LLC, etc.)", () => {
    const plain = scoreLetterhead([item("Acme Co", 0, 0)], 800);
    const withSuffix = scoreLetterhead([item("Acme LLC", 0, 0)], 800);
    expect(withSuffix).toBeGreaterThan(plain);
  });

  it("bumps score for horizontally-centered clusters", () => {
    // Page width 800, centerline 400.
    const centered = scoreLetterhead(
      [item("Centered Title", 380, 0, { width: 40 })],
      800,
    );
    const leftAligned = scoreLetterhead(
      [item("Left Title", 30, 0, { width: 40 })],
      800,
    );
    expect(centered).toBeGreaterThan(leftAligned);
  });

  it("caps the score at 0.95 to leave headroom for AI agreement", () => {
    const item1 = item(
      "Sterling & Partners LLP · 100 Market Street · www.sterling.example · (415) 555-0123",
      380,
      0,
      { width: 40, height: 24 },
    );
    expect(scoreLetterhead([item1], 800)).toBeLessThanOrEqual(0.95);
  });

  it("returns a meaningful score even with one item", () => {
    // Should never crash or NaN out on edge cases.
    const s = scoreLetterhead([item("Acme", 100, 0)], 800);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(0.95);
  });
});
