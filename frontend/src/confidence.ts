/**
 * Confidence-bar rendering. Pure DOM construction, no global state.
 *
 * Used by region cards (per-region confidence) and the sidebar
 * "X of N would be flagged" impact line.
 */

export function buildConfidenceBar(
  value: number,
  detected: boolean,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "confidence-row";

  const bar = document.createElement("div");
  bar.className = "confidence-bar";

  const fill = document.createElement("div");
  // When the region wasn't detected, we DON'T grow the bar. The
  // "confidence" in that case describes certainty-of-absence, which
  // is a different signal from "certainty of detection." Painting a
  // growing colored bar there would conflict with the "not detected"
  // text label and confuse the user.
  const widthPct = detected
    ? Math.max(0, Math.min(100, value * 100))
    : 0;
  fill.className =
    "confidence-bar-fill " + (detected ? confidenceTier(value) : "low");
  fill.style.width = `${widthPct}%`;
  bar.appendChild(fill);
  row.appendChild(bar);

  const text = document.createElement("div");
  if (detected) {
    text.className = "confidence-text";
    text.textContent = `${(value * 100).toFixed(0)}% conf.`;
  } else {
    text.className = "confidence-text not-detected";
    text.textContent = "not detected";
  }
  row.appendChild(text);

  return row;
}

export function confidenceTier(value: number): "low" | "mid" | "high" {
  if (value < 0.5) return "low";
  if (value < 0.75) return "mid";
  return "high";
}
