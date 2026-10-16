import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { FORMATTER_MODES, assertFormatterModes } from "./formatter_modes.mjs";

test("formatting expectations cover every canonical temporal and principal mode", () => {
  const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(new URL(
    "../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url,
  ))));
  assertFormatterModes(name => registry.getEnum(name));
});

for (const name of Object.keys(FORMATTER_MODES)) {
  test(`${name}: future, missing, or duplicate enum modes cannot silently inherit an expectation`, () => {
    for (const invalid of [[0, 1, 2, 3, 999], [0, 1, 2], [0, 0, 1, 2, 3]]) {
      assert.throws(() => assertFormatterModes(fullName => ({ values:
        (fullName.endsWith(`.${name}`) ? invalid : [0, 1, 2, 3]).map(number => ({ number })),
      })), new RegExp(`${name}: update the explicit formatting corpus`));
    }
  });
}
