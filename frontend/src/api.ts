import type { ExtractionResult } from "./types.js";

/**
 * Thin HTTP layer. Keeps fetch and error decoding out of the UI module
 * so components only deal with typed promises.
 */

export interface HealthResponse {
  ok: boolean;
  aiFallbackAvailable: boolean;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`Health endpoint returned ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export type AiMode = "off" | "auto" | "on";

export async function extractDocument(
  file: File,
  ai: AiMode = "off",
): Promise<ExtractionResult> {
  const formData = new FormData();
  formData.append("file", file);
  const url = `/api/extract?ai=${ai}`;

  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    // The backend's classifyError produces a friendly `error` string
    // for every 4xx. Surface it; the caller shows it directly.
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as ExtractionResult;
}
