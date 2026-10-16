import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(new URL(
  "../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url,
))));
const schema = registry.getMessage("meridian.ui.v1.ComputedStat");

test("native Stat result is canonical protobuf with shared Trend and Tone", () => {
  assert.equal(schema.file.proto.name, "proto/stat.proto");
  assert.deepEqual(schema.fields.map(field => [field.name, field.number]), [
    ["formatted_value", 1], ["trend", 2], ["formatted_delta", 3], ["tone", 4], ["series", 5],
  ]);
  assert.equal(schema.fields[1].enum.typeName, "meridian.ui.v1.Trend");
  assert.equal(schema.fields[3].enum.typeName, "meridian.ui.v1.Tone");
  assert.equal(schema.fields[2].proto.proto3Optional, true);
  assert.equal(schema.fields[4].fieldKind, "list");
});

test("computed delta distinguishes absent from present empty through wire round trips", () => {
  const absent = fromJson(schema, { formattedValue: "0", tone: 1 });
  const empty = fromJson(schema, { formattedValue: "0", formattedDelta: "", tone: 1 });
  assert.notDeepEqual(toBinary(schema, absent), toBinary(schema, empty));
  assert.equal(fromBinary(schema, toBinary(schema, absent)).formattedDelta, undefined);
  assert.equal(fromBinary(schema, toBinary(schema, empty)).formattedDelta, "");
  const unknown = fromJson(schema, { formattedValue: "raw", trend: 999, tone: 999 });
  assert.equal(fromBinary(schema, toBinary(schema, unknown)).tone, 999);
  assert.equal(fromBinary(schema, toBinary(schema, unknown)).trend, 999);
});
