/**
 * Tolerant JSON extraction from LLM output.
 *
 * Models sometimes wrap JSON in ```json``` fences, add a "Here you go:"
 * preamble, or trail an explanation. We accept all of those: scan the text
 * for the first {...} block and parse that. If parsing fails, return null
 * rather than throwing — calls land in fallback paths where null means
 * "couldn't help, use the deterministic result."
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  if (!text) return null;
  // Greedy match to last } so we still parse correctly if the object
  // contains nested braces.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
