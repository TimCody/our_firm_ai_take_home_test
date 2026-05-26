/**
 * Sidebar: preset selector and the live "X of N would be flagged" line.
 *
 * Four discrete presets bundle deadline, throughput, user count, and
 * the recommended confidence threshold into one opinionated choice.
 * Picking a preset shows engineering judgment ("here's how I'd run
 * this at that scale"), where a slider would just ask the user to
 * invent values.
 */
import type { AppState } from "./state.js";
import { PRESETS, type Preset, type PresetId } from "./presets.js";
import type { DocState } from "./types.js";

export interface SidebarRefs {
  presetList: HTMLElement;
  presetDetail: HTMLElement;
  hitlImpact: HTMLElement;
  healthIndicator: HTMLElement;
}

export function renderPresetList(
  container: HTMLElement,
  activeId: PresetId,
  onSelect: (id: PresetId) => void,
): void {
  container.innerHTML = "";

  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-card";
    btn.setAttribute("aria-pressed", String(preset.id === activeId));
    btn.dataset.presetId = preset.id;

    const name = document.createElement("div");
    name.className = "preset-name";
    name.textContent = preset.title;
    btn.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "preset-meta";
    meta.textContent = preset.summary;
    btn.appendChild(meta);

    btn.addEventListener("click", () => onSelect(preset.id));
    container.appendChild(btn);
  }
}

export function renderPresetDetail(
  container: HTMLElement,
  preset: Preset,
): void {
  container.innerHTML = "";

  const dl = document.createElement("dl");
  dl.className = "preset-detail-dl";

  const rows: [string, string][] = [
    ["Deadline", preset.context.deadline],
    ["Users", preset.context.users],
    ["Throughput", preset.context.throughput],
    [
      "Confidence",
      `${(preset.context.confidenceThreshold * 100).toFixed(0)}% threshold`,
    ],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  container.appendChild(dl);

  const reasoning = document.createElement("p");
  reasoning.className = "preset-rationale";
  reasoning.textContent = preset.thresholdRationale;
  container.appendChild(reasoning);
}

/**
 * Count how many of the uploaded docs have any region below the active
 * preset's confidence threshold. This is what makes the preset choice
 * feel real: the user sees their docs get sorted as they switch presets.
 */
export function computeFlaggedCount(
  docs: DocState[],
  threshold: number,
): { flagged: number; total: number } {
  let flagged = 0;
  let total = 0;

  for (const doc of docs) {
    if (!doc.result) continue;
    total++;

    const regions = Object.values(doc.result.regions);
    let anyBelow = false;
    for (const r of regions) {
      if (!r.detected || r.confidence < threshold) {
        anyBelow = true;
        break;
      }
    }

    if (anyBelow) flagged++;
  }

  return { flagged, total };
}

export function formatImpact(flagged: number, total: number): string {
  if (total === 0) {
    return "Upload documents to see how many would route to human review.";
  }
  if (flagged === 0) {
    return `All ${total} document${total === 1 ? "" : "s"} would auto-approve at this threshold.`;
  }
  return `${flagged} of ${total} document${
    total === 1 ? "" : "s"
  } would be flagged for human review.`;
}

export function updateSidebar(refs: SidebarRefs, state: AppState): void {
  // Keep the preset cards' aria-pressed state in sync with the store.
  for (const btn of refs.presetList.querySelectorAll<HTMLButtonElement>(
    ".preset-card",
  )) {
    btn.setAttribute(
      "aria-pressed",
      String(btn.dataset.presetId === state.presetId),
    );
  }

  const preset =
    PRESETS.find((p) => p.id === state.presetId) ?? PRESETS[0]!;
  renderPresetDetail(refs.presetDetail, preset);

  const { flagged, total } = computeFlaggedCount(
    state.docs,
    preset.context.confidenceThreshold,
  );
  refs.hitlImpact.textContent = formatImpact(flagged, total);
}
