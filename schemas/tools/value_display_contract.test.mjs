// Schema compatibility for roadmap #49. Use the actual canonical descriptor
// set, not a parallel handwritten schema. Renderer presentation is verified by
// the stateful corpus and interaction suites, not by wire compatibility alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clone, createFileRegistry, equals, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const descriptors = fromBinary(FileDescriptorSetSchema, readFileSync(new URL(
  "../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url,
)));
const registry = createFileRegistry(descriptors);
const cases = [
  ["TableColumn", "value_display", 6, { header: "Value", fieldPath: "value", format: 1 }],
  ["StatPanel", "value_display", 16, { label: "Count", value: 12, format: 1, previous: 0 }],
  ["FormField", "display", 13, { fieldId: "value", label: "Value", text: { defaultValue: "0012" } }],
  ["DescriptorRow", "display", 3, { label: "Value", sourcePath: "value" }],
  ["Block.Field", "display", 3, { key: "Value", value: "0012" }],
  ["Block.Cell", "display", 2, { value: "0012" }],
];

// Derive old-reader views by removing only the additive field. Every unrelated
// field, annotation, nested message, enum, and import stays canonical.
const oldDescriptors = clone(FileDescriptorSetSchema, descriptors);
function removeDisplay(messages, prefix) {
  for (const message of messages) {
    const name = `${prefix}.${message.name}`;
    const entry = cases.find(([short]) => name === `meridian.ui.v1.${short}`);
    if (entry) message.field = message.field.filter(field => field.name !== entry[1]);
    removeDisplay(message.nestedType, name);
  }
}
for (const file of oldDescriptors.file) removeDisplay(file.messageType, file.package);
const oldRegistry = createFileRegistry(oldDescriptors);

for (const [short, fieldName, number, legacyJson] of cases) {
  const name = `meridian.ui.v1.${short}`;
  test(`${short}: shared display is an additive, presence-tracked message at stable tag ${number}`, () => {
    const schema = registry.getMessage(name);
    const field = schema.fields.find(field => field.name === fieldName);
    assert.ok(field, `${name}.${fieldName} missing`);
    assert.equal(field.number, number);
    assert.equal(field.fieldKind, "message");
    assert.equal(field.message.typeName, "meridian.ui.v1.ValueDisplay");
    assert.equal(field.oneof, undefined);
    assert.equal(field.proto.proto3Optional, false);
    assert.equal(field.proto.label, 1, "singular optional message, not repeated or required");

    const current = fromJson(schema, legacyJson);
    const oldSchema = oldRegistry.getMessage(name);
    const old = fromJson(oldSchema, legacyJson);
    assert.equal(current[field.localName], undefined);
    assert.deepEqual(toBinary(schema, current), toBinary(oldSchema, old), "unset declaration must add no wire bytes");
    assert.deepEqual(toJson(schema, current), toJson(oldSchema, old), "unset declaration must add no JSON property");

    for (const display of [{}, { type: 3 }, { type: 999 }]) {
      const declared = fromJson(schema, { ...legacyJson, [field.jsonName]: display });
      const bytes = toBinary(schema, declared);
      assert.ok(bytes.length > toBinary(schema, current).length);
      const decoded = fromBinary(schema, bytes);
      assert.notEqual(decoded[field.localName], undefined, "explicit empty display has presence");
      assert.ok(equals(schema, declared, decoded));
      const oldReader = fromBinary(oldSchema, bytes);
      assert.deepEqual(toJson(oldSchema, oldReader), toJson(oldSchema, old), "old reader sees unchanged legacy values");
      assert.ok(equals(schema, declared, fromBinary(schema, toBinary(oldSchema, oldReader))),
        "old reader preserves unknown display field through a wire round trip");
    }
  });
}

test("RecordCard fields reuse FormField and its shared display without another formatting shape", () => {
  const fields = registry.getMessage("meridian.ui.v1.RecordCardPanel").fields.find(field => field.name === "fields");
  assert.equal(fields.fieldKind, "list");
  assert.equal(fields.message.typeName, "meridian.ui.v1.FormField");
});

test("conversation table rich cells coexist with unchanged legacy string cells", () => {
  const schema = registry.getMessage("meridian.ui.v1.Block.Row");
  const original = fromJson(schema, {
    cells: { count: "legacy", other: "unchanged" },
    displayCells: { count: { value: "", display: { type: 3 } } },
  });
  const decoded = fromBinary(schema, toBinary(schema, original));
  assert.deepEqual(toJson(schema, decoded), {
    cells: { count: "legacy", other: "unchanged" },
    displayCells: { count: { display: { type: "VALUE_TYPE_INTEGER" } } },
  });
  assert.equal(decoded.displayCells.count.value, "", "an explicitly empty rich cell is not the legacy value");
});
