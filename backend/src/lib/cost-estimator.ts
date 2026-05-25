/**
 * Token + USD cost estimator for Anthropic vision calls.
 *
 * We surface this in the UI before firing the AI fallback so the user
 * sees what they're about to spend. Estimates only — actual cost may differ
 * by a few percent based on how Anthropic resizes the image internally.
 *
 * Pricing as of 2026 (per million tokens):
 *   - Haiku 4.5: $1 input / $5 output
 *   - Sonnet 4.6: $3 input / $15 output
 *
 * Vision token formula (Anthropic-documented heuristic): roughly
 *   image_tokens ≈ (width × height) / 750
 * Anthropic caps the longest edge of resized images at 1568px, so we apply
 * the same cap before estimating.
 */
export type SupportedModel = "haiku" | "sonnet";

const PRICING: Record<
  SupportedModel,
  { id: string; inputPerMTok: number; outputPerMTok: number }
> = {
  haiku: {
    id: "claude-haiku-4-5-20251001",
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
  },
  sonnet: {
    id: "claude-sonnet-4-6",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
  },
};

const MAX_EDGE_PX = 1568;

export interface CostEstimateInput {
  imageWidth: number;
  imageHeight: number;
  /** Approx prompt overhead in input tokens (system + instruction). */
  promptTokens?: number;
  /** max_tokens we'll ask for. */
  maxOutputTokens?: number;
  model?: SupportedModel;
}

export interface CostEstimate {
  model: string;
  imageTokens: number;
  promptTokens: number;
  maxOutputTokens: number;
  inputTokens: number;
  /** USD cost assuming output uses all `maxOutputTokens`. Upper bound. */
  estimatedUsd: number;
  /** Human-friendly cost string for UI display. */
  pretty: string;
}

export function estimateVisionCost(opts: CostEstimateInput): CostEstimate {
  const {
    imageWidth,
    imageHeight,
    promptTokens = 200,
    maxOutputTokens = 256,
    model = "haiku",
  } = opts;

  const pricing = PRICING[model];
  const imageTokens = computeImageTokens(imageWidth, imageHeight);
  const inputTokens = imageTokens + promptTokens;
  const inputUsd = (inputTokens / 1_000_000) * pricing.inputPerMTok;
  const outputUsd = (maxOutputTokens / 1_000_000) * pricing.outputPerMTok;
  const estimatedUsd = inputUsd + outputUsd;

  return {
    model: pricing.id,
    imageTokens,
    promptTokens,
    maxOutputTokens,
    inputTokens,
    estimatedUsd,
    pretty: formatCost(estimatedUsd),
  };
}

/**
 * Anthropic resizes images so the longest edge is ≤1568px before pricing.
 * Apply the same downscale before counting tokens.
 */
export function computeImageTokens(width: number, height: number): number {
  const longest = Math.max(width, height);
  let w = width;
  let h = height;
  if (longest > MAX_EDGE_PX) {
    const scale = MAX_EDGE_PX / longest;
    w = width * scale;
    h = height * scale;
  }
  return Math.ceil((w * h) / 750);
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `~$${usd.toFixed(4)}`;
  if (usd < 1) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(2)}`;
}
