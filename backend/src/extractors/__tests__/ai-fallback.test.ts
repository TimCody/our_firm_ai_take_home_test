import { describe, expect, it } from "vitest";
import { parseAllRegionsResponse } from "../ai-fallback.js";

describe("parseAllRegionsResponse", () => {
  it("parses a clean three-region response from the model", () => {
    const text = JSON.stringify({
      letterhead: { present: true, x: 0, y: 0, w: 1, h: 0.15, note: "blue ribbon" },
      footer: { present: true, x: 0, y: 0.95, w: 1, h: 0.05, note: "" },
      signature: { present: true, x: 0.1, y: 0.7, w: 0.3, h: 0.1, note: "italic name" },
    });
    const r = parseAllRegionsResponse(text);
    expect(r).not.toBeNull();
    expect(r!.letterhead?.present).toBe(true);
    expect(r!.footer?.h).toBeCloseTo(0.05);
    expect(r!.signature?.note).toBe("italic name");
  });

  it("coerces stringy numbers into numbers", () => {
    // Some models hand back stringified numbers. We don't want to fail
    // the whole response over that.
    const text = JSON.stringify({
      signature: { present: true, x: "0.1", y: 0.5, w: 0.2, h: 0.05 },
    });
    const r = parseAllRegionsResponse(text);
    expect(r?.signature?.x).toBe(0.1);
  });

  it("defaults missing coordinates to 0", () => {
    const text = JSON.stringify({ signature: { present: false } });
    expect(r(text).signature).toEqual({
      present: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      note: undefined,
    });
  });

  it("tolerates code-fenced JSON", () => {
    const fenced =
      "```json\n" +
      JSON.stringify({
        signature: { present: true, x: 0, y: 0, w: 0.1, h: 0.05 },
      }) +
      "\n```";
    expect(parseAllRegionsResponse(fenced)?.signature?.present).toBe(true);
  });

  it("tolerates leading prose before the JSON", () => {
    const withProse =
      "Sure, here's the analysis:\n" +
      JSON.stringify({
        signature: { present: true, x: 0.1, y: 0.7, w: 0.3, h: 0.1 },
      });
    expect(parseAllRegionsResponse(withProse)?.signature?.x).toBe(0.1);
  });

  it("returns null on garbage input", () => {
    expect(parseAllRegionsResponse("I can't help with that.")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseAllRegionsResponse("{not valid")).toBeNull();
  });

  it("rejects non-string notes", () => {
    const text = JSON.stringify({
      signature: { present: true, x: 0, y: 0, w: 0.1, h: 0.05, note: 123 },
    });
    expect(parseAllRegionsResponse(text)?.signature?.note).toBeUndefined();
  });

  it("returns an object even when only one region is reported", () => {
    // Claude can omit regions it doesn't see. Each key is optional.
    const text = JSON.stringify({
      signature: { present: true, x: 0.1, y: 0.7, w: 0.3, h: 0.1 },
    });
    const parsed = parseAllRegionsResponse(text);
    expect(parsed?.signature).toBeDefined();
    expect(parsed?.letterhead).toBeUndefined();
    expect(parsed?.footer).toBeUndefined();
  });
});

function r(text: string) {
  const parsed = parseAllRegionsResponse(text);
  if (!parsed) throw new Error("expected a parsed result");
  return parsed;
}
