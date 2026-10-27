import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { expect, it } from "vitest";
import { affordancePresentation } from "./affordance_presentation.js";
import { readFrozen } from "../../tests/frozen_affordance.js";

it.each([undefined, 0, 1, 2, 999])("emphasis %s has presence precedence, independently of Tone and legacy style", emphasis => {
  for (const style of [0, 1, 2, 999]) for (const tone of [undefined, 0, 1, 2, 3, 4, 5, 6, 999]) {
    const action = readFrozen(AffordanceSchema, { style, ...(tone === undefined ? {} : { tone }), ...(emphasis === undefined ? {} : { emphasis }), label: "Action", command: "raw command" });
    const bytes = toBinary(AffordanceSchema, action);
    const decoded = fromBinary(AffordanceSchema, bytes);
    const presentation = affordancePresentation(decoded);
    const primary = emphasis === 1;
    expect(presentation.primary).toBe(primary);
    expect(presentation.tone).toBe(tone === undefined ? undefined : ["neutral", "neutral", "info", "success", "warning", "danger", "accent"][tone] ?? "neutral");
    expect(presentation.style.fontWeight).toBe(emphasis === undefined ? undefined : primary ? "var(--mer-heading-weight, 600)" : "var(--mer-body-weight, 400)");
    expect(presentation.style.borderWidth).toBe(emphasis === undefined ? undefined : primary ? "2px" : "1px");
    expect(decoded.invoke).toEqual(action.invoke);
    expect(toBinary(AffordanceSchema, decoded)).toEqual(bytes);
  }
});

it("leaves legacy presentation entirely host-owned when both fields are absent", () => {
  for (const style of [0, 1, 2, 999]) expect(affordancePresentation(readFrozen(AffordanceSchema, { style })).style).toEqual({});
});
