import { expect, it } from "vitest";
import { conversationSequenceKey } from "./conversation_sequence.js";

it("retains the full uint64 decimal domain without number conversion", () => {
  for (const value of ["0", "9007199254740991", "9007199254740992", "9007199254740993", "18446744073709551614", "18446744073709551615"]) {
    expect(conversationSequenceKey(value)).toBe(value);
    expect(conversationSequenceKey(`000${value}`)).toBe(value);
  }
  for (const value of [0, 7, Number.MAX_SAFE_INTEGER]) expect(conversationSequenceKey(value)).toBe(String(value));
  expect(conversationSequenceKey("000")).toBe("0");
});

it("does not manufacture deduplication identities from invalid or rounded input", () => {
  for (const value of [undefined, null, true, {}, [], "", " ", "+1", "-1", "1.0", "1e3", "NaN", "Infinity", "18446744073709551616", "9".repeat(1000), -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(conversationSequenceKey(value)).toBeUndefined();
  }
});
