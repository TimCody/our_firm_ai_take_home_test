/**
 * Top-level wiring. Single Store, DOM event handlers, and tells the
 * rendering modules when state has changed.
 *
 * Kept deliberately linear — anything more than glue lives in its own module.
 */
import "./styles.css";
import { Store, createInitialState, savePresetId } from "./state.js";
import { renderGallery } from "./gallery.js";
import {
  renderPresetList,
  updateSidebar,
} from "./sidebar.js";
import { renderArchitecture } from "./architecture.js";
import { extractDocument, fetchHealth } from "./api.js";
import { getPreset } from "./presets.js";
import type { DocState } from "./types.js";

// ---------- DOM refs ----------
const dropzone = mustGet("dropzone");
const fileInput = mustGet<HTMLInputElement>("file-input");

const sidebarRefs = {
  presetList: mustGet("preset-list"),
  presetDetail: mustGet("preset-detail"),
  hitlImpact: mustGet("hitl-impact"),
  healthIndicator: mustGet("health-indicator"),
};

const galleryRefs = {
  gallerySection: mustGet("gallery-section"),
  galleryStrip: mustGet("gallery-strip"),
  prevBtn: mustGet<HTMLButtonElement>("prev-btn"),
  nextBtn: mustGet<HTMLButtonElement>("next-btn"),
  activeFilename: mustGet("active-filename"),
  activePosition: mustGet("active-position"),
  previewContainer: mustGet("preview-container"),
  regionsContainer: mustGet("regions-container"),
  aiPanel: mustGet("ai-panel"),
  meta: mustGet("meta"),
};

const archRefs = {
  section: mustGet("architecture-section"),
  title: mustGet("arch-title"),
  diagram: mustGet<HTMLPreElement>("arch-diagram"),
  notesList: mustGet("arch-notes"),
};

// ---------- state ----------
const store = new Store(createInitialState());

store.subscribe((state) => {
  updateSidebar(sidebarRefs, state);
  renderGallery(galleryRefs, state, {
    onSelect: (id) => store.update((s) => ({ ...s, activeId: id })),
    onPrev: () => navigate(-1),
    onNext: () => navigate(1),
    onImprove: (id) => void improveWithAi(id),
  });
  renderArchitecture(archRefs, getPreset(state.presetId));
});

// ---------- preset selector ----------
renderPresetList(sidebarRefs.presetList, store.get().presetId, (presetId) => {
  store.update((s) => {
    savePresetId(presetId);
    return { ...s, presetId };
  });
});

// ---------- dropzone ----------
dropzone.addEventListener("click", (e) => {
  if ((e.target as HTMLElement) === fileInput) return;
  fileInput.click();
});
dropzone.addEventListener("keydown", (e) => {
  const key = (e as KeyboardEvent).key;
  if (key === "Enter" || key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-active");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-active"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-active");
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) acceptFiles(Array.from(files));
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files;
  if (files && files.length > 0) acceptFiles(Array.from(files));
  fileInput.value = "";
});

// ---------- keyboard navigation ----------
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  if (e.key === "ArrowLeft") navigate(-1);
  if (e.key === "ArrowRight") navigate(1);
});

// ---------- health probe ----------
void (async () => {
  try {
    const health = await fetchHealth();
    sidebarRefs.healthIndicator.textContent = health.aiFallbackAvailable
      ? "online · AI fallback enabled"
      : "online · AI fallback disabled (set ANTHROPIC_API_KEY)";
    sidebarRefs.healthIndicator.classList.add("up");
    store.update((s) => ({ ...s, aiAvailable: health.aiFallbackAvailable }));
  } catch (err) {
    sidebarRefs.healthIndicator.textContent = `offline · ${
      err instanceof Error ? err.message : "unknown"
    }`;
    sidebarRefs.healthIndicator.classList.add("down");
  }
})();

// ---------- actions ----------
function acceptFiles(files: File[]): void {
  const newDocs: DocState[] = files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    status: "pending",
  }));
  store.update((s) => ({
    ...s,
    docs: [...s.docs, ...newDocs],
    activeId: s.activeId ?? newDocs[0]?.id ?? null,
  }));
  // Sequential extraction so the backend isn't slammed by N parallel
  // pdfjs renders. With docs/day in the hundreds (MVP preset) this is fine;
  // at department scale we'd switch to SQS workers (see the diagram).
  void extractQueue(newDocs.map((d) => d.id));
}

async function extractQueue(ids: string[]): Promise<void> {
  for (const id of ids) {
    await extractOne(id);
  }
}

async function extractOne(id: string): Promise<void> {
  const doc = store.get().docs.find((d) => d.id === id);
  if (!doc) return;
  setDoc(id, { status: "extracting" });
  try {
    const result = await extractDocument(doc.file, "off");
    setDoc(id, { status: "ready", result });
  } catch (err) {
    setDoc(id, {
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

async function improveWithAi(id: string): Promise<void> {
  const doc = store.get().docs.find((d) => d.id === id);
  if (!doc || !doc.result) return;
  setDoc(id, { improving: true });
  try {
    const result = await extractDocument(doc.file, "on");
    setDoc(id, { improving: false, result });
  } catch (err) {
    setDoc(id, {
      improving: false,
      error: err instanceof Error ? err.message : "AI call failed",
    });
  }
}

function setDoc(id: string, patch: Partial<DocState>): void {
  store.update((s) => ({
    ...s,
    docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  }));
}

function navigate(direction: -1 | 1): void {
  const s = store.get();
  if (s.docs.length === 0) return;
  const idx = s.docs.findIndex((d) => d.id === s.activeId);
  const nextIdx = Math.max(0, Math.min(s.docs.length - 1, idx + direction));
  const next = s.docs[nextIdx];
  if (next) store.update((cur) => ({ ...cur, activeId: next.id }));
}

function mustGet<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing #${id} in DOM`);
  return el;
}
