/**
 * Gallery rendering: thumbnail strip, prev/next nav, and the active
 * document's preview + regions + AI panel.
 *
 * Render is idempotent. Call `renderGallery(state)` whenever something
 * interesting changes; this module diffs the active doc into place.
 *
 * Memoization is important here. We're called on every state update,
 * and re-rendering the PDF preview on every keystroke would flash the
 * canvas. So preview and regions both cache their last-rendered key
 * on the container's `dataset`, and bail out when the key hasn't
 * changed. See `previewCacheKey` and `regionsCacheKey` below.
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

  const active =
    state.docs.find((d) => d.id === state.activeId) ?? state.docs[0];
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

  const preset = getPreset(state.presetId);

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

    // Show a small flagged pip when any of this doc's regions falls
    // below the active preset's HITL threshold. Quick at-a-glance
    // signal across the whole upload batch.
    if (
      doc.result &&
      hasFlaggedRegion(doc, preset.context.confidenceThreshold)
    ) {
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
  for (const region of Object.values(doc.result.regions)) {
    if (!region.detected) return true;
    if (region.confidence < threshold) return true;
  }
  return false;
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
 * Memoize the preview by document id. Without this, every state
 * update (e.g. a sibling doc finishing extraction) would re-run pdfjs
 * and visibly flash the canvas.
 *
 * For non-PDF inputs we only render after the server returns the page
 * previews, so we also key on whether previews are present yet.
 */
async function renderActivePreview(
  container: HTMLElement,
  doc: DocState,
): Promise<void> {
  const previewKey = previewCacheKey(doc);
  if (container.dataset.previewKey === previewKey) return;
  container.dataset.previewKey = previewKey;
  container.innerHTML = "";

  // For PDFs the client-side preview kicks in immediately. For other
  // types we wait for server-side previews, so show a placeholder.
  if (doc.status === "extracting" && doc.file.type !== "application/pdf") {
    const note = document.createElement("p");
    note.className = "rationale";
    note.textContent = "Rendering preview & extracting regions...";
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
  // PDFs render client-side, so doc id alone is enough to key off.
  if (doc.file.type === "application/pdf") return `pdf:${doc.id}`;
  // Non-PDFs need the server's page previews. Include "ready" once
  // those are available so the placeholder re-renders into real content.
  return `other:${doc.id}:${doc.result ? "ready" : "pending"}`;
}

function renderActiveRegions(
  container: HTMLElement,
  doc: DocState,
  hitlThreshold: number,
): void {
  // Cheap memoization for the regions panel. Without this we'd flash
  // the cards on every state update (e.g. each time a sibling doc
  // finishes extracting).
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
    wait.textContent = "Extracting...";
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
