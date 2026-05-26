/**
 * Region card renderer.
 *
 * Renders one of letterhead / footer / signature with its confidence
 * bar, rationale, cropped image, and download buttons.
 *
 * Card-level concerns only. The "Improve with LLM" button lives one
 * level up (on the document, not on each region) because a single
 * AI call now updates all three regions at once.
 */
import { buildConfidenceBar } from "./confidence.js";
import type {
  ExtractionResult,
  RegionKind,
  RegionResult,
} from "./types.js";

const TITLES: Record<RegionKind, string> = {
  letterhead: "Letterhead",
  footer: "Footer",
  signature: "Signature",
};

export interface RegionCardOptions {
  region: RegionResult;
  result: ExtractionResult;
  /** Threshold from the sidebar; decides whether the card gets a "flagged" border. */
  hitlThreshold: number;
}

export function buildRegionCard(opts: RegionCardOptions): HTMLElement {
  const { region, result, hitlThreshold } = opts;
  const flagged = isFlagged(region, hitlThreshold);

  const card = document.createElement("div");
  card.className = "region-card";
  if (!region.detected) card.classList.add("missing");
  if (flagged) card.classList.add("flagged");

  card.appendChild(buildHead(region, result));
  card.appendChild(buildConfidenceBar(region.confidence, region.detected));

  if (flagged && region.detected) {
    const flag = document.createElement("p");
    flag.className = "flag-note";
    flag.textContent = `Below your ${(hitlThreshold * 100).toFixed(0)}% threshold. Would be flagged for review.`;
    card.appendChild(flag);
  }

  const rationale = document.createElement("p");
  rationale.className = "rationale";
  rationale.textContent = region.rationale;
  card.appendChild(rationale);

  if (region.detected && region.imageDataUrl) {
    card.appendChild(buildCropImage(region));
    card.appendChild(buildActions(region, result));
  }

  return card;
}

function isFlagged(region: RegionResult, threshold: number): boolean {
  // Not-detected always counts as flagged.
  if (!region.detected) return true;
  return region.confidence < threshold;
}

function buildHead(
  region: RegionResult,
  result: ExtractionResult,
): HTMLElement {
  const head = document.createElement("div");
  head.className = "region-card-head";

  const title = document.createElement("h3");
  title.textContent = TITLES[region.kind];

  // Show an "AI" badge next to the title when this region was touched
  // by the AI improvement step.
  if (region.kind === "signature" && result.usedAiFallback) {
    const aiBadge = document.createElement("span");
    aiBadge.className = "badge ai";
    aiBadge.textContent = "AI";
    title.appendChild(document.createTextNode(" "));
    title.appendChild(aiBadge);
  }
  head.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "head-meta";
  if (region.detected && region.page) {
    meta.textContent = `p.${region.page} · ${region.width}×${region.height}px`;
  } else {
    meta.textContent = "-";
  }
  head.appendChild(meta);

  return head;
}

function buildCropImage(region: RegionResult): HTMLElement {
  const img = document.createElement("img");
  img.className = "crop";
  img.src = region.imageDataUrl!;
  img.alt = `${region.kind} region`;
  return img;
}

function buildActions(
  region: RegionResult,
  result: ExtractionResult,
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "actions";

  const pngLink = document.createElement("a");
  pngLink.className = "button";
  pngLink.href = region.imageDataUrl!;
  pngLink.download = downloadName(result.fileName, region.kind, "png");
  pngLink.textContent = "PNG";
  actions.appendChild(pngLink);

  const jpegBtn = document.createElement("button");
  jpegBtn.textContent = "JPEG";
  jpegBtn.addEventListener("click", () => {
    void downloadAsJpeg(
      region.imageDataUrl!,
      downloadName(result.fileName, region.kind, "jpg"),
    );
  });
  actions.appendChild(jpegBtn);

  return actions;
}

/**
 * Convert the PNG data URL to a JPEG on the fly and trigger a download.
 *
 * We paint white behind the PNG first because JPEG has no alpha channel.
 * Without that, a region with transparency comes out black-backgrounded,
 * which is ugly.
 */
async function downloadAsJpeg(
  dataUrl: string,
  filename: string,
): Promise<void> {
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load region image."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  const jpegUrl = canvas.toDataURL("image/jpeg", 0.92);
  const a = document.createElement("a");
  a.href = jpegUrl;
  a.download = filename;
  a.click();
}

function downloadName(
  source: string,
  kind: RegionKind,
  ext: "png" | "jpg",
): string {
  const base = source.replace(/\.[^.]+$/, "");
  return `${base}.${kind}.${ext}`;
}
