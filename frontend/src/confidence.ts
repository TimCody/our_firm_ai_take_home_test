/**
 * Confidence-bar rendering. Pure DOM construction — no global state.
 *
 * Used by:
 *   - region cards (per-region confidence)
 *   - the sidebar "X of N would be flagged" impact line
 */
export function buildConfidenceBar(value: number, detected: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "confidence-row";

  const bar = document.createElement("div");
  bar.className = "confidence-bar";
  const fill = document.createElement("div");
  fill.className = "confidence-bar-fill " + confidenceTier(value);
  fill.style.width = `${Math.max(0, Math.min(100, value * 100))}%`;
  bar.appendChild(fill);
  row.appendChild(bar);

  const text = document.createElement("div");
  if (!detected) {
    text.className = "confidence-text not-detected";
    text.textContent = "not detected";
  } else {
    text.className = "confidence-text";
    text.textContent = `${(value * 100).toFixed(0)}% conf.`;
  }
  row.appendChild(text);

  return row;
}

export function confidenceTier(value: number): "low" | "mid" | "high" {
  if (value < 0.5) return "low";
  if (value < 0.75) return "mid";
  return "high";
}
