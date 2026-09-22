import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "../src/utf8.js";

describe("utf8ByteLength", () => {
  it("matches TextEncoder across ASCII, multibyte, and surrogate pairs", () => {
    for (const value of ["", "Meridian", "café", "🙂", "a🙂é", "\ud800", "\udc00"]) {
      expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength);
    }
  });
});
