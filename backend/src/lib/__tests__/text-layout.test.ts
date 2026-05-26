import { describe, expect, it } from "vitest";
import {
  averageCenterX,
  findTopCluster,
  groupIntoLines,
  isHorizontallyCentered,
  lineText,
} from "../text-layout.js";
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

describe("groupIntoLines", () => {
  it("returns empty array on empty input", () => {
    expect(groupIntoLines([])).toEqual([]);
  });

  it("groups items at the same y-coordinate into one line", () => {
    const lines = groupIntoLines([
      item("hello", 0, 100),
      item("world", 60, 100),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.items).toHaveLength(2);
  });

  it("separates items whose y differs by more than tolerance", () => {
    // Default tolerance is 4 and these are 6 apart.
    const lines = groupIntoLines([
      item("top", 0, 100),
      item("bottom", 0, 106),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("groups items within tolerance even if y is off by 1-2px", () => {
    // Often happens with PDF descenders. Same line, slightly different y.
    const lines = groupIntoLines([
      item("regular", 0, 100),
      item("descender", 60, 102),
    ]);
    expect(lines).toHaveLength(1);
  });

  it("sorts lines top-to-bottom regardless of input order", () => {
    const lines = groupIntoLines([
      item("bottom", 0, 500),
      item("top", 0, 50),
      item("middle", 0, 250),
    ]);
    expect(lines.map((l) => l.y)).toEqual([50, 250, 500]);
  });

  it("uses the tallest height in the line", () => {
    const lines = groupIntoLines([
      item("short", 0, 100, { height: 10 }),
      item("BIG", 60, 100, { height: 24 }),
    ]);
    expect(lines[0]!.height).toBe(24);
  });

  it("respects a custom tolerance", () => {
    const lines = groupIntoLines(
      [item("a", 0, 100), item("b", 0, 108)],
      10, // generous tolerance, should group
    );
    expect(lines).toHaveLength(1);
  });
});

describe("lineText", () => {
  it("joins items with a single space", () => {
    const line = groupIntoLines([
      item("Hello,", 0, 100),
      item("world!", 50, 100),
    ])[0]!;
    expect(lineText(line)).toBe("Hello, world!");
  });
});

describe("findTopCluster", () => {
  it("returns null when no text in the top quartile", () => {
    const cluster = findTopCluster(
      [item("bottom-only", 0, 800)],
      1000,
    );
    expect(cluster).toBeNull();
  });

  it("returns items in the top quartile", () => {
    // pageHeight=1000 → quartile cutoff = 250
    const cluster = findTopCluster(
      [
        item("title", 0, 50),
        item("subtitle", 0, 90),
        item("body", 0, 400),
      ],
      1000,
    );
    expect(cluster).not.toBeNull();
    expect(cluster!.items).toHaveLength(2);
  });

  it("clusters within the configured window from the topmost item", () => {
    // clusterWindow defaults to 0.12 → 120px on a 1000-page.
    // Top item at y=50, window cutoff at y=170, so item at 100 is in
    // and item at 200 is out.
    const cluster = findTopCluster(
      [
        item("a", 0, 50),
        item("b", 0, 100),
        item("c", 0, 200),
      ],
      1000,
    );
    expect(cluster!.items.map((i) => i.str)).toEqual(["a", "b"]);
  });

  it("reports the bottomY as the bottom edge of the deepest item", () => {
    const cluster = findTopCluster(
      [item("top", 0, 50, { height: 30 })],
      1000,
    );
    expect(cluster!.bottomY).toBe(80);
  });
});

describe("isHorizontallyCentered", () => {
  it("recognizes centered text", () => {
    // Page width 800, centerline 400. Item centered at 405, within 8% (64px).
    const items = [item("Title", 380, 50, { width: 50 })];
    expect(isHorizontallyCentered(items, 800)).toBe(true);
  });

  it("rejects left-aligned text", () => {
    const items = [item("Title", 50, 50, { width: 50 })];
    expect(isHorizontallyCentered(items, 800)).toBe(false);
  });

  it("treats empty items as not centered", () => {
    expect(isHorizontallyCentered([], 800)).toBe(false);
  });
});

describe("averageCenterX", () => {
  it("returns 0 for empty input", () => {
    expect(averageCenterX([])).toBe(0);
  });

  it("averages the centers of multiple items", () => {
    // centers: 50, 150 → avg 100
    const result = averageCenterX([
      item("a", 0, 0, { width: 100 }),
      item("b", 100, 0, { width: 100 }),
    ]);
    expect(result).toBe(100);
  });
});
