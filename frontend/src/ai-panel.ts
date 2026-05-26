/**
 * "Improve with LLM" panel.
 *
 * Shows the cost transparency BEFORE the call goes out: model id, token
 * counts, dollar estimate, what changes after the call.
 *
 * Manual-only by default. The deterministic pipeline always runs first,
 * and the user opts in to AI by clicking. This is the more honest UX:
 * the user sees the price tag and decides whether the document is
 * worth a Claude call.
 */
import type { AiCostEstimate, DocState } from "./types.js";

export interface AiPanelOptions {
  doc: DocState;
  aiAvailable: boolean;
  onImprove: () => void;
}

export function buildAiPanel(opts: AiPanelOptions): HTMLElement | null {
  const { doc, aiAvailable, onImprove } = opts;

  if (!doc.result) return null;

  const cost = doc.result.aiCostEstimate;
  // DOCX and image paths don't expose a cost estimate, so we don't
  // render the panel for those input types.
  if (!cost) return null;

  const panel = document.createElement("div");
  panel.className = "ai-panel";

  panel.appendChild(buildHeader(doc));
  panel.appendChild(buildDescription(doc));
  panel.appendChild(buildCostTable(cost));
  panel.appendChild(buildButton({ doc, aiAvailable, onImprove }));

  return panel;
}

function buildHeader(doc: DocState): HTMLElement {
  const h3 = document.createElement("h3");
  h3.textContent = doc.result?.usedAiFallback
    ? "AI vision already applied"
    : "Improve regions with AI";
  return h3;
}

function buildDescription(doc: DocState): HTMLElement {
  const p = document.createElement("p");
  if (doc.result?.usedAiFallback) {
    p.textContent =
      "Claude Haiku 4.5 has already located the regions on this document. Re-run to try again.";
  } else {
    p.textContent =
      "Send the last page to Claude Haiku 4.5 to locate the signature and footer (plus letterhead on single-page docs). Best when deterministic extractors miss or low-confidence a region. Most dramatic on scanned or image-only PDFs. Cost preview below.";
  }
  return p;
}

function buildCostTable(cost: AiCostEstimate): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "cost";

  const dl = document.createElement("dl");
  const rows: [string, string][] = [
    ["Model", cost.model],
    ["Image tokens", String(cost.imageTokens)],
    ["Prompt tokens", `~${cost.promptTokens}`],
    ["Max output", String(cost.maxOutputTokens)],
    ["Estimated cost", cost.pretty],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  wrap.appendChild(dl);
  return wrap;
}

function buildButton(opts: AiPanelOptions): HTMLElement {
  const { doc, aiAvailable, onImprove } = opts;
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.type = "button";
  btn.disabled = !aiAvailable || doc.improving === true;

  if (!aiAvailable) {
    btn.textContent = "Set ANTHROPIC_API_KEY to enable";
  } else if (doc.improving) {
    btn.textContent = "Calling Claude...";
  } else if (doc.result?.usedAiFallback) {
    btn.textContent = "Re-run AI vision";
  } else {
    btn.textContent = "Improve regions with LLM";
  }

  btn.addEventListener("click", onImprove);
  return btn;
}
