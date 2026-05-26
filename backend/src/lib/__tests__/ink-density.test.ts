import { describe, expect, it } from "vitest";
import { computeRowDarkness, findDensestDarkRun } from "../ink-density.js";

/**
 * Build a grayscale buffer of `width × height` with optional dark rows.
 * `darkRows` is a Set of y-indices that should be fully black; everything
 * else is fully white.
 */
function makeGrayscale(
  width: number,
  height: number,
  darkRows: Set<number>,
): Uint8Array {
  const buf = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const value = darkRows.has(y) ? 0 : 255;
    for (let x = 0; x < width; x++) {
      buf[y * width + x] = value;
    }
  }
  return buf;
}

describe("computeRowDarkness", () => {
  it("returns all-zero densities for a fully white image", () => {
    const buf = makeGrayscale(10, 5, new Set());
    expect(computeRowDarkness(buf, 10, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("returns all-one densities for a fully black image", () => {
    const buf = makeGrayscale(10, 5, new Set([0, 1, 2, 3, 4]));
    expect(computeRowDarkness(buf, 10, 5)).toEqual([1, 1, 1, 1, 1]);
  });

  it("identifies a single dark row in the middle", () => {
    const buf = makeGrayscale(10, 5, new Set([2]));
    const result = computeRowDarkness(buf, 10, 5);
    expect(result[2]).toBe(1);
    expect(result[0]).toBe(0);
    expect(result[4]).toBe(0);
  });

  it("respects a custom darkThreshold", () => {
    // Mid-grey row (value 130). Threshold default 140 → counts as dark.
    // Threshold lowered to 100 → no longer dark.
    const buf = new Uint8Array(10 * 1);
    buf.fill(130);
    expect(computeRowDarkness(buf, 10, 1)[0]).toBe(1);
    expect(computeRowDarkness(buf, 10, 1, 100)[0]).toBe(0);
  });
});

describe("findDensestDarkRun", () => {
  it("returns null when nothing is above the density threshold", () => {
    expect(findDensestDarkRun([0, 0, 0, 0.01, 0])).toBeNull();
  });

  it("returns null when only short runs exist (below minLength)", () => {
    // minLength defaults to 12. A single dark row won't qualify.
    expect(findDensestDarkRun([0, 0.5, 0])).toBeNull();
  });

  it("finds a single qualifying run", () => {
    // 20 contiguous rows at density 0.5
    const rows = new Array(30).fill(0);
    for (let i = 5; i < 25; i++) rows[i] = 0.5;
    const run = findDensestDarkRun(rows);
    expect(run).not.toBeNull();
    expect(run!.start).toBe(5);
    expect(run!.end).toBe(25);
  });

  it("picks the densest run when there are multiple", () => {
    // Two runs of equal length. Second is denser.
    const rows = new Array(60).fill(0);
    for (let i = 5; i < 25; i++) rows[i] = 0.1;
    for (let i = 35; i < 55; i++) rows[i] = 0.5;
    const run = findDensestDarkRun(rows);
    expect(run!.start).toBe(35);
  });

  it("ends the run at the first below-threshold row", () => {
    const rows = new Array(40).fill(0);
    for (let i = 0; i < 20; i++) rows[i] = 0.5;
    // Row 20 is white, so the run should close at 20.
    const run = findDensestDarkRun(rows);
    expect(run!.end).toBe(20);
  });

  it("handles a run that extends to the very last row", () => {
    const rows = new Array(20).fill(0.5);
    const run = findDensestDarkRun(rows);
    expect(run).not.toBeNull();
    expect(run!.start).toBe(0);
    expect(run!.end).toBe(20);
  });
});
