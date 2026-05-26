export type RegionKind = "letterhead" | "footer" | "signature";

export interface RegionResult {
  kind: RegionKind;
  detected: boolean;
  imageDataUrl: string | null;
  confidence: number;
  page: number | null;
  rationale: string;
  width: number | null;
  height: number | null;
}

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
  pagePreviews: string[];
  regions: Record<RegionKind, RegionResult>;
  usedAiFallback: boolean;
  aiCostEstimate: AiCostEstimate | null;
  aiAvailable: boolean;
  warnings: string[];
}

/** Client-side state for one uploaded document. */
export interface DocState {
  id: string;
  file: File;
  status: "pending" | "extracting" | "ready" | "error";
  result?: ExtractionResult;
  error?: string;
  /** True while an AI-improvement request is in flight. */
  improving?: boolean;
}
