/**
 * Ink-density analysis on rasterized page bands.
 *
 * Used by the signature extractor to find handwritten-looking dark
 * streaks that don't align with the page's text rows.
 *
 * This module is a pair of pure functions. The caller does the heavy
 * lifting (extracting the image region and converting to grayscale with
 * sharp); we just look at the raw byte array and decide where the ink
 * lives.
 */

/**
 * For each row of a grayscale buffer, return the fraction of pixels
 * darker than `darkThreshold`. Higher number = more ink in that row.
 *
 * The default threshold of 140 treats anything darker than mid-grey as
 * ink. Lower it (around 100) for high-contrast scans only. Raise it
 * (around 180) if you want to catch very light pencil signatures.
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
      const pixel = grayData[rowStart + x];
      if (pixel !== undefined && pixel < darkThreshold) {
        darkCount++;
      }
    }

    rows[y] = darkCount / width;
  }

  return rows;
}

export interface DarkRun {
  start: number;
  end: number;
  /** Sum of row densities across the run. Higher = denser. */
  score: number;
}

/**
 * Find the densest contiguous run of rows above `minDensity` that's at
 * least `minLength` rows tall. Returns null when nothing qualifies.
 *
 * The "minimum length" check matters: a single dark row is noise (a
 * stray glyph descender, a page border). A run of 12+ rows is a real
 * horizontal feature on the page. For our 2x render scale, that's
 * about a 6-pixel band in original PDF coordinates, which roughly
 * matches the height of a handwritten signature stroke.
 */
export function findDensestDarkRun(
  rowDarkness: number[],
  minDensity = 0.02,
  minLength = 12,
): DarkRun | null {
  let best: DarkRun | null = null;
  let runStart = -1;
  let runSum = 0;

  // Walk one past the end so we close out any run that extends to the
  // final row.
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
      // Run just ended. Check if it qualifies and beats the current best.
      const length = y - runStart;
      const qualifies = length >= minLength;
      const isBest = best === null || runSum > best.score;
      if (qualifies && isBest) {
        best = { start: runStart, end: y, score: runSum };
      }
      runStart = -1;
    }
  }

  return best;
}
