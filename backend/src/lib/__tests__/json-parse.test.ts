import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../json-parse.js";

describe("extractJsonObject", () => {
  it("parses plain JSON", () => {
    expect(extractJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  it("tolerates leading prose before the JSON", () => {
    const text = 'Sure, here is the response:\n{"present": true}';
    expect(extractJsonObject(text)).toEqual({ present: true });
  });

  it("tolerates trailing prose after the JSON", () => {
    const text = '{"x": 0.5} (let me know if you need anything else!)';
    expect(extractJsonObject(text)).toEqual({ x: 0.5 });
  });

  it("tolerates markdown code fences", () => {
    const text = '```json\n{"y": 0.42}\n```';
    expect(extractJsonObject(text)).toEqual({ y: 0.42 });
  });

  it("handles nested objects", () => {
    const text = '{"outer": {"inner": [1, 2, 3]}}';
    expect(extractJsonObject(text)).toEqual({ outer: { inner: [1, 2, 3] } });
  });

  it("returns null on empty input", () => {
    expect(extractJsonObject("")).toBeNull();
  });

  it("returns null when there's no { in the text", () => {
    expect(extractJsonObject("I cannot help with that.")).toBeNull();
  });

  it("returns null on malformed JSON without throwing", () => {
    // Important guarantee: parse errors must not propagate. Calling code
    // expects null → "couldn't help, use deterministic result."
    expect(extractJsonObject("{this is not valid json")).toBeNull();
  });
});
