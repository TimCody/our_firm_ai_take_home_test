import { describe, expect, it } from "vitest";
import { parseVisionResponse } from "../ai-fallback.js";

describe("parseVisionResponse", () => {
  it("parses a clean response from the model", () => {
    const r = parseVisionResponse(
      '{"present": true, "x": 0.1, "y": 0.7, "w": 0.3, "h": 0.1, "note": "signature visible"}',
    );
    expect(r).toEqual({
      present: true,
      x: 0.1,
      y: 0.7,
      w: 0.3,
      h: 0.1,
      note: "signature visible",
    });
  });

  it("coerces stringy numbers to numbers", () => {
    // Defensive: some models occasionally hand back stringified numbers.
    const r = parseVisionResponse('{"present": true, "x": "0.1", "y": 0.5, "w": 0.2, "h": 0.05}');
    expect(r?.x).toBe(0.1);
  });

  it("defaults missing coordinates to 0", () => {
    const r = parseVisionResponse('{"present": false}');
    expect(r).toEqual({
      present: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      note: undefined,
    });
  });

  it("tolerates code-fenced JSON", () => {
    const r = parseVisionResponse(
      '```json\n{"present": true, "x": 0, "y": 0, "w": 0.1, "h": 0.05}\n```',
    );
    expect(r?.present).toBe(true);
  });

  it("returns null on garbage input", () => {
    expect(parseVisionResponse("I can't help with that.")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseVisionResponse("{not valid")).toBeNull();
  });

  it("rejects non-string notes", () => {
    const r = parseVisionResponse('{"present": true, "note": 123}');
    expect(r?.note).toBeUndefined();
  });
});
