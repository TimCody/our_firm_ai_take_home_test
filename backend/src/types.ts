export type RegionKind = "letterhead" | "footer" | "signature";

export interface RegionResult {
  kind: RegionKind;
  detected: boolean;
  /** PNG buffer encoded as base64 data URL, or null if not detected. */
  imageDataUrl: string | null;
  /** Confidence 0..1. Heuristic, not calibrated. */
  confidence: number;
  /** Page number the region was found on (1-indexed). null when not detected. */
  page: number | null;
  /** Free-form explanation of how this region was located, surfaced in the UI. */
  rationale: string;
  /** Width and height of the cropped region in pixels. */
  width: number | null;
  height: number | null;
}

/**
 * Estimated cost (USD) of calling the AI vision fallback for this document.
 * Returned with every extraction so the UI can show the user what an
 * "Improve with LLM" click would cost before they click it.
 */
export interface AiCostEstimate {
  model: string;
  imageTokens: number;
  promptTokens: number;
  maxOutputTokens: number;
  estimatedUsd: number;
  pretty: string;
}

export interface ExtractionResult {
  documentId: string;
  fileName: string;
  mimeType: string;
  pageCount: number;
  /** Preview thumbnails (one per page) as base64 PNG data URLs. */
  pagePreviews: string[];
  regions: Record<RegionKind, RegionResult>;
  /** Whether the AI vision fallback ran on this response. */
  usedAiFallback: boolean;
  /** Cost the next AI call would incur on this document. */
  aiCostEstimate: AiCostEstimate | null;
  /** Is the AI fallback available (ANTHROPIC_API_KEY set)? */
  aiAvailable: boolean;
  warnings: string[];
}

export interface PageRender {
  pageIndex: number;
  width: number;
  height: number;
  pngBuffer: Buffer;
  /** Text items with bounding boxes, in page coordinate space (origin top-left). */
  textItems: TextItem[];
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  italic?: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
