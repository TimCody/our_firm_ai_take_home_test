/**
 * Pure helpers for reasoning about a page's text layer.
 *
 * Everything here is data-in / data-out (no fs, no canvas) so it can be
 * unit-tested without spinning up pdfjs or rendering anything.
 */
import type { TextItem } from "../types.js";

export interface TextLine {
  /** Top-left Y of the line (pixel coords). */
  y: number;
  /** Height of the tallest glyph in the line. */
  height: number;
  items: TextItem[];
}

/**
 * Group text items into visual lines by Y coordinate proximity.
 *
 * Items whose y-positions differ by less than `tolerance` pixels are treated
 * as a single line. The result is ordered top-to-bottom.
 *
 * `tolerance` defaults to 4px — tuned for the page-render scale of 2×.
 * If you ever change the render scale, scale the tolerance too.
 */
export function groupIntoLines(
  items: TextItem[],
  tolerance = 4,
): TextLine[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const lines: TextLine[] = [];

  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(item.y - last.y) <= tolerance) {
      last.items.push(item);
      last.height = Math.max(last.height, item.height);
    } else {
      lines.push({ y: item.y, height: item.height, items: [item] });
    }
  }
  return lines;
}

/**
 * Concatenate the text content of a line (space-separated).
 */
export function lineText(line: TextLine): string {
  return line.items.map((i) => i.str).join(" ");
}

export interface TopCluster {
  /** Items belonging to the cluster. */
  items: TextItem[];
  /** Y of the topmost item. */
  topY: number;
  /** Y + height of the deepest item. */
  bottomY: number;
}

/**
 * Find the topmost cluster of text on a page — the candidate letterhead.
 *
 * Two-step:
 *   1. Filter to items in the top quartile of the page.
 *   2. From those, take everything that lives within `clusterWindow` of
 *      the highest item. That's our cluster.
 *
 * Returns null if there's no text in the top quartile.
 */
export function findTopCluster(
  items: TextItem[],
  pageHeight: number,
  clusterWindow = 0.12,
): TopCluster | null {
  const topQuartile = pageHeight * 0.25;
  const topItems = items.filter((t) => t.y < topQuartile);
  if (topItems.length === 0) return null;

  const sorted = [...topItems].sort((a, b) => a.y - b.y);
  const topY = sorted[0]!.y;
  const cutoff = topY + pageHeight * clusterWindow;
  const cluster = sorted.filter((t) => t.y < cutoff);
  const bottomY = Math.max(...cluster.map((t) => t.y + t.height));

  return { items: cluster, topY, bottomY };
}

/**
 * Compute the horizontal center of mass of a set of text items.
 * Useful for "is this cluster centered on the page?" scoring.
 */
export function averageCenterX(items: TextItem[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, t) => acc + (t.x + t.width / 2), 0);
  return sum / items.length;
}

/**
 * True if the cluster's center sits within `tolerance` (as a fraction of
 * page width) of the page's vertical centerline.
 */
export function isHorizontallyCentered(
  items: TextItem[],
  pageWidth: number,
  tolerance = 0.08,
): boolean {
  const center = averageCenterX(items);
  return Math.abs(center - pageWidth / 2) < pageWidth * tolerance;
}
