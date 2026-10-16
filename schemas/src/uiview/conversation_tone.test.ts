import { create, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { StatusSchema, Block_ToolBlockSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { deriveToneCases, toneCases } from "../../conformance/tone_cases.js";
import { ToneSchema } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { PaletteSchema } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { expect, it } from "vitest";
import { conversationToneRole, conversationToolState, conversationStatusState } from "./conversation_tone.js";

it("derives every canonical Tone and rejects missing palette bindings instead of silently skipping cases", () => {
  expect(toneCases.map(entry => entry.tone)).toEqual(ToneSchema.values.map(entry => entry.number));
  expect(() => deriveToneCases(ToneSchema.values, PaletteSchema.fields.filter(field => field.name !== "danger"))).toThrow("TONE_DANGER has no Palette.danger binding");
  const future = { ...ToneSchema.values[0]!, name: "TONE_FUTURE", number: 999 };
  expect(() => deriveToneCases([...ToneSchema.values, future])).toThrow("TONE_FUTURE has no Palette.future binding");
});

it("retains optional presence and all six Tone roles through binary and JSON", () => {
  for (const schema of [StatusSchema, Block_ToolBlockSchema]) {
    expect(conversationToneRole(create(schema).tone)).toBeUndefined();
    for (const { tone, role } of toneCases) {
      for (const jsonTone of [tone, `TONE_${tone === 0 ? "UNSPECIFIED" : role.toUpperCase()}`]) {
        const original = fromJson(schema, { tone: jsonTone });
        const decoded = fromBinary(schema, toBinary(schema, original));
        expect(decoded.tone).toBe(tone);
        expect(conversationToneRole(decoded.tone)).toBe(role);
        expect(conversationToneRole(jsonTone)).toBe(role);
      }
    }
  }
});

it("never revives legacy styling for explicit unknown/unspecified declarations", () => {
  for (const tone of [0, 999, -1, 1.5, "TONE_UNSPECIFIED", "FUTURE", {}, [], 'warning\" onclick=bad'])
    expect(conversationToneRole(tone)).toBe("neutral");
  for (const tone of [undefined, null]) expect(conversationToneRole(tone)).toBeUndefined();
});

it("recognizes both canonical numeric and named operational states independently of Tone", () => {
  expect([undefined, 0, "RUNNING"].map(conversationToolState)).toEqual(["RUNNING", "RUNNING", "RUNNING"]);
  expect([1, "OK"].map(conversationToolState)).toEqual(["OK", "OK"]);
  expect([2, "ERROR"].map(conversationToolState)).toEqual(["ERROR", "ERROR"]);
  expect([2, "THINKING"].map(conversationStatusState)).toEqual(["THINKING", "THINKING"]);
  expect([3, "WORKING"].map(conversationStatusState)).toEqual(["WORKING", "WORKING"]);
  expect([undefined, 0, 1, 999, "IDLE"].map(conversationStatusState)).toEqual(Array(5).fill("IDLE"));
});
