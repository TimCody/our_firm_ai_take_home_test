/**
 * Ink-density analysis on rasterized page bands.
 *
 * Used by the signature extractor to find handwritten-looking dark streaks
 * that don't align with the page's text rows.
 *
 * Pure-function pair: caller does the image extraction + grayscale conversion
 * with sharp, then hands us the raw byte array.
 */

/**
 * For each row of a grayscale buffer, compute the fraction of pixels below
 * `darkThreshold` (i.e. "how much ink lives in this row").
 *
 * The default threshold (140) treats anything darker than mid-grey as ink.
 * Lower it to 100 for high-contrast scans only; raise it to 180 if you
 * want to catch very light pencil signatures.
 */
export function computeRowDarkness(
  grayData: Uint8Array,
  width: number,
  height: number,
  darkThreshold = 140,
): number[] {
  const rows: number[] = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let darkCount = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const v = grayData[rowStart + x];
      if (v !== undefined && v < darkThreshold) darkCount++;
    }
    rows[y] = darkCount / width;
  }
  return rows;
}

export interface DarkRun {
  start: number;
  end: number;
  /** Sum of row densities across the run — higher means denser. */
  score: number;
}

/**
 * Find the densest contiguous run of rows above `minDensity` that's at
 * least `minLength` rows tall.
 *
 * Returns null if no run qualifies.
 *
 * Used to locate signature-shaped streaks: signatures show up as a few
 * dozen rows of moderately-dark pixels, narrower than a paragraph block.
 */
export function findDensestDarkRun(
  rowDarkness: number[],
  minDensity = 0.02,
  minLength = 12,
): DarkRun | null {
  let best: DarkRun | null = null;
  let runStart = -1;
  let runSum = 0;

  for (let y = 0; y <= rowDarkness.length; y++) {
    const v = rowDarkness[y];
    const isDark = v !== undefined && v > minDensity;

    if (isDark) {
      if (runStart === -1) {
        runStart = y;
        runSum = 0;
      }
      runSum += v;
    } else if (runStart !== -1) {
      const length = y - runStart;
      if (length >= minLength && (!best || runSum > best.score)) {
        best = { start: runStart, end: y, score: runSum };
      }
      runStart = -1;
    }
  }
  return best;
}
