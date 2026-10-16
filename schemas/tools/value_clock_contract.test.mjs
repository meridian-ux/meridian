import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { assertValueClockContract } from "./value_clock_contract.mjs";

const cases = JSON.parse(readFileSync(new URL("../conformance/core.json", import.meta.url))).valueFormats;
const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(
  new URL("../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url))));
const resultSchema = registry.getMessage("meridian.ui.v1.FormattedValue");
const expected = name => {
  const entry = cases.find(entry => entry.name === name);
  assert.ok(entry, name);
  return toJson(resultSchema, fromBinary(resultSchema, Buffer.from(entry.expected, "base64")));
};

test("every explicit clock has a no-clock twin without changing input/display", () => {
  assertValueClockContract(cases);
  assert.equal(cases.filter(entry => Object.hasOwn(entry, "nowMs")).length, 133);
});

test("clock-pair gate rejects missing, duplicate, clocked, changed and empty twins", () => {
  const source = cases.find(entry => entry.name === "epoch-zero-clock");
  const twin = cases.find(entry => entry.name === "no-clock-epoch-zero-clock");
  for (const entries of [[source], [source, twin, twin],
    [source, { ...twin, nowMs: 0 }], [source, { ...twin, display: "" }],
    [source, { ...twin, input: false }], [source, { ...twin, expected: "" }]]) {
    assert.throws(() => assertValueClockContract(entries));
  }
});

test("all temporal display/precision combinations have authored absolute no-clock fallback", () => {
  const forms = [
    [8, ["Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026"]],
    [9, ["Mar 30, 2026, 1:30 AM UTC", "Mar 30, 2026", "Mar 30, 2026, 1:30 AM UTC", "Mar 30, 2026, 1:30:07 AM UTC"]],
    [10, ["11:30 PM UTC", "11:30 PM UTC", "11:30 PM UTC", "11:30:07 PM UTC"]],
  ];
  for (const [type, absolute] of forms) for (let mode = 0; mode <= 3; mode++) {
    for (let precision = 0; precision <= 3; precision++) {
      assert.deepEqual(expected(`no-clock-calendar-grid-${type}-${mode}-${precision}`), { text: absolute[precision] });
    }
  }
});

test("removing a clock does not discard principal supporting text", () => {
  for (const type of [12, 13]) for (let mode = 0; mode <= 3; mode++) {
    assert.deepEqual(expected(`no-clock-principal-${type}-${mode}`), {
      text: mode === 2 ? "ada@example.com" : "Ada",
      ...(mode === 3 ? { title: "ada@example.com" } : {}),
    });
  }
});
