import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(new URL(
  "../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url,
))));
const context = registry.getMessage("meridian.ui.v1.RequestContext");

test("native request context uses presence and canonical value entries, not normalized dictionaries", () => {
  assert.equal(context.file.proto.name, "proto/rpc.proto");
  assert.deepEqual(context.fields.map(field => [field.name, field.number]), [
    ["current_resource_path", 1], ["ui_identity", 2], ["selected_row", 3],
    ["form_values", 4], ["signals", 5], ["selections", 6],
  ]);
  assert.equal(context.fields[0].proto.proto3Optional, true);
  for (const field of context.fields.slice(1, 3)) assert.equal(field.message.typeName, "google.protobuf.Value");
  for (const field of context.fields.slice(3)) {
    assert.equal(field.fieldKind, "list");
    assert.equal(field.message.typeName, "meridian.ui.v1.ContextValue");
  }
  const entry = registry.getMessage("meridian.ui.v1.ContextValue");
  assert.deepEqual(entry.fields.map(field => [field.name, field.number]), [["key", 1], ["value", 2]]);
  assert.equal(entry.fields[1].message.typeName, "google.protobuf.Value");
});

test("context wire preserves absent/empty resource paths and exact Unicode bag names", () => {
  const absent = fromJson(context, {}), empty = fromJson(context, { currentResourcePath: "" });
  assert.notDeepEqual(toBinary(context, absent), toBinary(context, empty));
  assert.equal(fromBinary(context, toBinary(context, absent)).currentResourcePath, undefined);
  assert.equal(fromBinary(context, toBinary(context, empty)).currentResourcePath, "");
  const input = fromJson(context, { selections: [{ key: "é", value: 0 }, { key: "e\u0301", value: false }] });
  const result = fromBinary(context, toBinary(context, input));
  assert.equal(result.selections.length, 2);
  assert.notEqual(result.selections[0].key, result.selections[1].key);
});
