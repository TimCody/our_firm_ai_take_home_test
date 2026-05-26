/**
 * Token and USD cost estimator for Anthropic vision calls.
 *
 * We surface this in the UI before firing the AI fallback, so the user
 * sees what they're about to spend. These are estimates only. Actual
 * cost may differ by a few percent depending on how Anthropic resizes
 * the image internally and how long the model's reply ends up being.
 *
 * Pricing (per million tokens, as of early 2026):
 *   Haiku 4.5:  $1 input  / $5 output
 *   Sonnet 4.6: $3 input  / $15 output
 *
 * Vision token formula (per Anthropic's docs): roughly
 *   image_tokens ~= (width * height) / 750
 * Anthropic also caps the longest edge of resized images at 1568px,
 * so we apply the same cap before counting tokens.
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
  /** Approximate prompt overhead in input tokens (system + instruction). */
  promptTokens?: number;
  /** The max_tokens we'll ask for. */
  maxOutputTokens?: number;
  model?: SupportedModel;
}

export interface CostEstimate {
  model: string;
  imageTokens: number;
  promptTokens: number;
  maxOutputTokens: number;
  inputTokens: number;
  /**
   * USD cost assuming output uses all `maxOutputTokens`. This is an
   * upper bound. Reality is usually a bit less.
   */
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
 * Anthropic downscales images so the longest edge is at most 1568px
 * before pricing. We mirror that downscale before counting tokens.
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

/**
 * Pretty-print a USD value. Different precision based on magnitude
 * because "$0.0041" reads better than "$0.00" for sub-cent costs.
 */
export function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `~$${usd.toFixed(4)}`;
  if (usd < 1) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(2)}`;
}
