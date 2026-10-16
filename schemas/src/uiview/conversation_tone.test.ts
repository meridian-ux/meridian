import { create, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { StatusSchema, Block_ToolBlockSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { expect, it } from "vitest";
import { conversationToneRole, conversationToolState, conversationStatusState } from "./conversation_tone.js";

it("retains optional presence and all six Tone roles through binary and JSON", () => {
  const names = ["neutral", "info", "success", "warning", "danger", "accent"];
  for (const schema of [StatusSchema, Block_ToolBlockSchema]) {
    expect(conversationToneRole(create(schema).tone)).toBeUndefined();
    for (let tone = 0; tone <= 6; tone++) {
      for (const jsonTone of [tone, `TONE_${tone === 0 ? "UNSPECIFIED" : names[tone - 1]!.toUpperCase()}`]) {
        const original = fromJson(schema, { tone: jsonTone });
        const decoded = fromBinary(schema, toBinary(schema, original));
        expect(decoded.tone).toBe(tone);
        expect(conversationToneRole(decoded.tone)).toBe(names[tone - 1] ?? "neutral");
        expect(conversationToneRole(jsonTone)).toBe(names[tone - 1] ?? "neutral");
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
