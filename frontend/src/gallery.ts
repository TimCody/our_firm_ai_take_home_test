/**
 * Gallery rendering: thumbnail strip + prev/next nav + active-doc rendering.
 *
 * Keeps DOM updates idempotent — call `renderGallery(state)` whenever
 * something interesting changes and it'll diff the active doc into place.
 */
import { buildRegionCard } from "./region-card.js";
import { buildAiPanel } from "./ai-panel.js";
import { renderImagePreviews, renderPdfPreview } from "./preview.js";
import { getPreset } from "./presets.js";
import type { AppState } from "./state.js";
import type { DocState, RegionKind } from "./types.js";

export interface GalleryRefs {
  gallerySection: HTMLElement;
  galleryStrip: HTMLElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  activeFilename: HTMLElement;
  activePosition: HTMLElement;
  previewContainer: HTMLElement;
  regionsContainer: HTMLElement;
  aiPanel: HTMLElement;
  meta: HTMLElement;
}

export interface GalleryHandlers {
  onSelect: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onImprove: (id: string) => void;
}

export function renderGallery(
  refs: GalleryRefs,
  state: AppState,
  handlers: GalleryHandlers,
): void {
  if (state.docs.length === 0) {
    refs.gallerySection.hidden = true;
    return;
  }
  refs.gallerySection.hidden = false;

  renderStrip(refs.galleryStrip, state, handlers);

  const active = state.docs.find((d) => d.id === state.activeId) ?? state.docs[0];
  if (!active) return;

  renderNav(refs, state, active, handlers);
  renderActive(refs, state, active, handlers);
}

function renderStrip(
  container: HTMLElement,
  state: AppState,
  handlers: GalleryHandlers,
): void {
  container.innerHTML = "";
  for (const doc of state.docs) {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "thumb";
    if (doc.id === state.activeId) thumb.classList.add("active");
    if (doc.status === "error") thumb.classList.add("error");
    if (doc.status === "extracting") thumb.classList.add("loading");
    thumb.addEventListener("click", () => handlers.onSelect(doc.id));

    if (doc.result?.pagePreviews[0]) {
      const img = document.createElement("img");
      img.src = doc.result.pagePreviews[0];
      img.alt = doc.file.name;
      thumb.appendChild(img);
    }

    const preset = getPreset(state.presetId);
    if (doc.result && hasFlaggedRegion(doc, preset.context.confidenceThreshold)) {
      const pip = document.createElement("span");
      pip.className = "flagged-pip";
      pip.title = `At least one region below the ${preset.title} threshold`;
      thumb.appendChild(pip);
    }

    const label = document.createElement("span");
    label.className = "thumb-label";
    label.textContent = doc.file.name;
    thumb.appendChild(label);

    container.appendChild(thumb);
  }
}

function hasFlaggedRegion(doc: DocState, threshold: number): boolean {
  if (!doc.result) return false;
  return Object.values(doc.result.regions).some(
    (r) => !r.detected || r.confidence < threshold,
  );
}

function renderNav(
  refs: GalleryRefs,
  state: AppState,
  active: DocState,
  handlers: GalleryHandlers,
): void {
  const idx = state.docs.findIndex((d) => d.id === active.id);
  refs.prevBtn.disabled = idx <= 0;
  refs.nextBtn.disabled = idx >= state.docs.length - 1;
  refs.prevBtn.onclick = handlers.onPrev;
  refs.nextBtn.onclick = handlers.onNext;

  refs.activeFilename.textContent = active.file.name;
  refs.activePosition.textContent = `(${idx + 1} of ${state.docs.length})`;
}

function renderActive(
  refs: GalleryRefs,
  state: AppState,
  active: DocState,
  handlers: GalleryHandlers,
): void {
  const preset = getPreset(state.presetId);
  void renderActivePreview(refs.previewContainer, active);
  renderActiveRegions(
    refs.regionsContainer,
    active,
    preset.context.confidenceThreshold,
  );
  renderActiveAiPanel(refs.aiPanel, active, state.aiAvailable, () =>
    handlers.onImprove(active.id),
  );
  renderActiveMeta(refs.meta, active);
}

/**
 * Memoize the preview by document id. Without this, every state update
 * (e.g. a sibling doc finishing extraction) would re-run pdfjs and visibly
 * flash the canvas.
 *
 * For non-PDF inputs we only render after the server returns the page
 * previews — so we also key on whether previews are present yet.
 */
async function renderActivePreview(
  container: HTMLElement,
  doc: DocState,
): Promise<void> {
  const previewKey = previewCacheKey(doc);
  if (container.dataset.previewKey === previewKey) return;
  container.dataset.previewKey = previewKey;
  container.innerHTML = "";

  if (doc.status === "extracting" && doc.file.type !== "application/pdf") {
    // For PDFs the client-side preview kicks in immediately. For other
    // types we wait for server-side previews — show a placeholder.
    const note = document.createElement("p");
    note.className = "rationale";
    note.textContent = "Rendering preview & extracting regions…";
    container.appendChild(note);
    return;
  }

  if (doc.file.type === "application/pdf") {
    try {
      await renderPdfPreview(doc.file, container);
    } catch (err) {
      container.innerHTML = `<p class="rationale">Preview failed: ${escapeHtml(
        String(err),
      )}</p>`;
    }
    return;
  }

  if (doc.result) {
    renderImagePreviews(doc.result.pagePreviews, container);
  }
}

function previewCacheKey(doc: DocState): string {
  // For PDFs the preview is purely client-side, so doc id is enough.
  // For non-PDFs we need to wait for the server to return previews, so we
  // include "has-previews" in the key.
  if (doc.file.type === "application/pdf") return `pdf:${doc.id}`;
  return `other:${doc.id}:${doc.result ? "ready" : "pending"}`;
}

function renderActiveRegions(
  container: HTMLElement,
  doc: DocState,
  hitlThreshold: number,
): void {
  // Cheap memoization: same doc + same threshold + same result version =
  // skip the rebuild. Without this we'd flash the cards every time a
  // sibling doc finishes extracting.
  const key = `${doc.id}:${doc.status}:${doc.result ? "ready" : "none"}:${
    doc.result?.usedAiFallback ? "ai" : "noai"
  }:${hitlThreshold}`;
  if (container.dataset.regionsKey === key) return;
  container.dataset.regionsKey = key;

  container.innerHTML = "";
  if (doc.status === "error") {
    const err = document.createElement("p");
    err.className = "rationale";
    err.style.color = "var(--bad)";
    err.textContent = `Extraction failed: ${doc.error ?? "unknown error"}`;
    container.appendChild(err);
    return;
  }
  if (!doc.result) {
    const wait = document.createElement("p");
    wait.className = "rationale";
    wait.textContent = "Extracting…";
    container.appendChild(wait);
    return;
  }

  for (const kind of ["letterhead", "footer", "signature"] as RegionKind[]) {
    container.appendChild(
      buildRegionCard({
        region: doc.result.regions[kind],
        result: doc.result,
        hitlThreshold,
      }),
    );
  }
}

function renderActiveAiPanel(
  container: HTMLElement,
  doc: DocState,
  aiAvailable: boolean,
  onImprove: () => void,
): void {
  container.innerHTML = "";
  const panel = buildAiPanel({ doc, aiAvailable, onImprove });
  if (panel) {
    container.appendChild(panel);
    container.hidden = false;
  } else {
    container.hidden = true;
  }
}

function renderActiveMeta(container: HTMLElement, doc: DocState): void {
  if (!doc.result) {
    container.textContent = "";
    return;
  }
  const r = doc.result;
  const parts: string[] = [
    `${r.pageCount} page${r.pageCount === 1 ? "" : "s"}`,
    r.mimeType,
  ];
  if (r.usedAiFallback) parts.push("AI fallback used");
  if (r.warnings.length > 0) parts.push("⚠ " + r.warnings.join("; "));
  container.textContent = parts.join("  ·  ");
  container.className = r.warnings.length > 0 ? "meta warning" : "meta";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
