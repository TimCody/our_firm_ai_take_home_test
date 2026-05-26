/**
 * Helpers for reasoning about a page's text layer.
 *
 * Everything here is data in, data out. No filesystem, no canvas, no
 * network. That makes the whole module easy to unit test without spinning
 * up pdfjs or rendering anything.
 */
import type { TextItem } from "../types.js";

export interface TextLine {
  /** Top-left Y of the line in pixel coords. */
  y: number;
  /** Height of the tallest glyph in the line. */
  height: number;
  items: TextItem[];
}

/**
 * Group text items into visual lines by Y coordinate proximity.
 *
 * Items whose y-positions differ by less than `tolerance` pixels are
 * treated as the same line. The result is ordered top-to-bottom.
 *
 * Why a tolerance and not a strict y match: PDF descenders (the part of
 * "g" or "y" that hangs below the baseline) often report a slightly
 * different y than their neighbors on the same line. 4 pixels is enough
 * to absorb that wobble at our 2x render scale. If you change the render
 * scale, scale this value too.
 */
export function groupIntoLines(
  items: TextItem[],
  tolerance = 4,
): TextLine[] {
  if (items.length === 0) return [];

  // Sort top-to-bottom so we can walk once and group adjacent items.
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const lines: TextLine[] = [];

  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const sameLine =
      last !== undefined && Math.abs(item.y - last.y) <= tolerance;

    if (sameLine) {
      last.items.push(item);
      if (item.height > last.height) {
        last.height = item.height;
      }
    } else {
      lines.push({ y: item.y, height: item.height, items: [item] });
    }
  }

  return lines;
}

/**
 * Join the text content of a line into a single string, separated by
 * spaces.
 */
export function lineText(line: TextLine): string {
  return line.items.map((i) => i.str).join(" ");
}

export interface TopCluster {
  /** Items belonging to the cluster. */
  items: TextItem[];
  /** Y of the topmost item. */
  topY: number;
  /** Y of the bottom edge of the deepest item. */
  bottomY: number;
}

/**
 * Find the topmost cluster of text on a page. This is the candidate for
 * the letterhead.
 *
 * Two steps:
 *   1. Filter to items in the top quartile of the page.
 *   2. From those, take everything that lives within `clusterWindow`
 *      (default 12% of page height) of the highest item. That's the
 *      cluster.
 *
 * Returns null when there's no text in the top quartile (which is the
 * case for image-only PDFs and posters).
 */
export function findTopCluster(
  items: TextItem[],
  pageHeight: number,
  clusterWindow = 0.12,
): TopCluster | null {
  const topQuartile = pageHeight * 0.25;
  const topItems = items.filter((t) => t.y < topQuartile);
  if (topItems.length === 0) return null;

  // The highest item anchors the cluster window.
  const sorted = [...topItems].sort((a, b) => a.y - b.y);
  const topY = sorted[0]!.y;
  const cutoff = topY + pageHeight * clusterWindow;
  const cluster = sorted.filter((t) => t.y < cutoff);

  // Bottom edge = highest (y + height) across all cluster members.
  let bottomY = 0;
  for (const item of cluster) {
    const itemBottom = item.y + item.height;
    if (itemBottom > bottomY) bottomY = itemBottom;
  }

  return { items: cluster, topY, bottomY };
}

/**
 * Average horizontal center of a set of text items. Used to score
 * whether a text cluster looks centered on the page (a strong letterhead
 * signal).
 */
export function averageCenterX(items: TextItem[]): number {
  if (items.length === 0) return 0;
  let sum = 0;
  for (const t of items) {
    sum += t.x + t.width / 2;
  }
  return sum / items.length;
}

/**
 * True if the cluster's center sits within `tolerance` (as a fraction of
 * page width) of the page's vertical centerline. Default tolerance is
 * 8%, which catches anything that looks visually centered without
 * false-positive on left-aligned text that happens to be wide.
 */
export function isHorizontallyCentered(
  items: TextItem[],
  pageWidth: number,
  tolerance = 0.08,
): boolean {
  if (items.length === 0) return false;
  const center = averageCenterX(items);
  const pageMid = pageWidth / 2;
  return Math.abs(center - pageMid) < pageWidth * tolerance;
}
