/**
 * Tolerant JSON extraction from LLM output.
 *
 * Why this exists: models occasionally wrap their JSON output in code
 * fences, add a "Sure, here you go:" preamble, or trail off with an
 * explanation. We don't want to fight any of that. Instead we scan the
 * text for the first `{...}` block and parse it.
 *
 * If parsing fails, we return null instead of throwing. Calling code
 * treats null as "couldn't help, use the deterministic result." Throwing
 * would propagate up and 500 the whole request, which is way worse than
 * a quiet null.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  if (!text) return null;

  // Greedy match from the first { to the last }. This keeps us
  // working even when the JSON contains nested braces.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
