import { describe, expect, it } from "vitest";
import {
  computeImageTokens,
  estimateVisionCost,
  formatCost,
} from "../cost-estimator.js";

describe("computeImageTokens", () => {
  it("uses the Anthropic w*h/750 heuristic for small images", () => {
    // 600 × 750 = 450,000 → 600 tokens
    expect(computeImageTokens(600, 750)).toBe(600);
  });

  it("downscales when the longest edge exceeds 1568px", () => {
    // A 3136×3136 image should scale to 1568×1568.
    // Tokens = 1568*1568/750 ≈ 3278
    const tokens = computeImageTokens(3136, 3136);
    expect(tokens).toBe(Math.ceil((1568 * 1568) / 750));
  });

  it("does not upscale small images", () => {
    expect(computeImageTokens(100, 100)).toBe(Math.ceil((100 * 100) / 750));
  });
});

describe("estimateVisionCost", () => {
  it("returns a sensible estimate for a standard letter page (Haiku)", () => {
    // 1224x1584 at 2x scale, a typical PDF page render.
    const estimate = estimateVisionCost({
      imageWidth: 1224,
      imageHeight: 1584,
      promptTokens: 200,
      maxOutputTokens: 256,
      model: "haiku",
    });
    // Sanity bounds: cents, not dollars; not micro-pennies.
    expect(estimate.estimatedUsd).toBeGreaterThan(0.001);
    expect(estimate.estimatedUsd).toBeLessThan(0.05);
  });

  it("Sonnet costs strictly more than Haiku for the same input", () => {
    const haiku = estimateVisionCost({
      imageWidth: 1224,
      imageHeight: 1584,
      model: "haiku",
    });
    const sonnet = estimateVisionCost({
      imageWidth: 1224,
      imageHeight: 1584,
      model: "sonnet",
    });
    expect(sonnet.estimatedUsd).toBeGreaterThan(haiku.estimatedUsd);
  });

  it("reports the correct Anthropic model id", () => {
    expect(
      estimateVisionCost({ imageWidth: 100, imageHeight: 100, model: "haiku" })
        .model,
    ).toBe("claude-haiku-4-5-20251001");
  });

  it("uses default prompt/output token budgets when not provided", () => {
    const e = estimateVisionCost({ imageWidth: 100, imageHeight: 100 });
    expect(e.promptTokens).toBe(200);
    expect(e.maxOutputTokens).toBe(256);
  });
});

describe("formatCost", () => {
  it("uses '<$0.001' for sub-mil costs", () => {
    expect(formatCost(0.0001)).toBe("<$0.001");
  });

  it("uses 4 decimal places for sub-cent costs", () => {
    expect(formatCost(0.003)).toBe("~$0.0030");
  });

  it("uses 3 decimal places for sub-dollar costs", () => {
    expect(formatCost(0.5)).toBe("~$0.500");
  });

  it("uses 2 decimal places for dollar-scale costs", () => {
    expect(formatCost(1.234)).toBe("~$1.23");
  });
});
