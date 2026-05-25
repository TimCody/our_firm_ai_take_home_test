/**
 * Region card — renders one of letterhead/footer/signature with confidence,
 * rationale, crop image, and download buttons.
 *
 * Card-level concerns only. The AI improvement button lives one level up
 * on the document card so it can replace ALL three regions at once if the
 * model produces a better answer.
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
  /** Threshold from the sidebar; affects whether the card gets a "flagged" border. */
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
    flag.textContent = `Below your ${(hitlThreshold * 100).toFixed(0)}% threshold — would be flagged for review.`;
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
    meta.textContent = "—";
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

async function downloadAsJpeg(dataUrl: string, filename: string): Promise<void> {
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
  // JPEG has no alpha — paint white behind the PNG to avoid black backgrounds.
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
