// EnumSelection options — labels, and the precedence form.proto declares.
//
// REGRESSION for a bug found in a browser, not in a test: a producer emitted
// `options` (schemas 0.21.0, carrying each value's localized label and tone),
// this kit read only `allowedValues`, and the dropdown rendered EMPTY with no
// error anywhere. The renderer looked broken; the descriptor was fine.
//
// Tested as a pure function rather than through the DOM on purpose. The rule
// being protected is precedence and fallback — pure logic — and asserting it via
// MUI's rendered listbox would couple a contract test to MUI's internals, so it
// would break on a component upgrade that changed nothing about the contract.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { EnumSelectionSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";

import { enumOptions } from "../src/mui_kit.js";

describe("EnumSelection options", () => {
  it("renders the producer's labels, and keeps the stored token as the value", () => {
    const got = enumOptions(
      create(EnumSelectionSchema, {
        options: [
          { value: "dev", label: "Development" },
          { value: "prod", label: "Production" },
        ],
      }),
    );
    expect(got).toEqual([
      { value: "dev", label: "Development" },
      { value: "prod", label: "Production" },
    ]);
  });

  // form.proto: "when both are set, `options` wins and `allowed_values` is
  // ignored, so a producer can populate both during a migration without
  // renderers double-listing." Reading allowedValues first would double-list.
  it("options WINS when both are set", () => {
    const got = enumOptions(
      create(EnumSelectionSchema, {
        allowedValues: ["dev", "prod"],
        options: [{ value: "dev", label: "Development" }],
      }),
    );
    expect(got).toEqual([{ value: "dev", label: "Development" }]);
  });

  // label is OPTIONAL and "falls back to `value` when empty" — a blank entry is
  // worse than a raw token, because it cannot be picked out of a list.
  it("falls back to the value when a label is empty", () => {
    expect(enumOptions(create(EnumSelectionSchema, { options: [{ value: "staging" }] }))).toEqual([
      { value: "staging", label: "staging" },
    ]);
  });

  // allowed_values is the pre-0.21 form and producers have not all migrated.
  it("still renders allowedValues when options is unset", () => {
    expect(enumOptions(create(EnumSelectionSchema, { allowedValues: ["dev", "prod"] }))).toEqual([
      { value: "dev", label: "dev" },
      { value: "prod", label: "prod" },
    ]);
  });

  it("an empty selection yields no options rather than throwing", () => {
    expect(enumOptions(create(EnumSelectionSchema, {}))).toEqual([]);
  });
});
