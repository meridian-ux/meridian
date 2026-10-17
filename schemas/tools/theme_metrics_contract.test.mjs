// The canonical Theme descriptor, not a parallel JSON schema, owns the wire.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clone, createFileRegistry, equals, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const descriptors = fromBinary(FileDescriptorSetSchema, readFileSync(new URL(
  "../../crates/core/rust/theme-proto/proto/gen/meridian_theme_v1.binpb", import.meta.url,
)));
const current = createFileRegistry(descriptors).getMessage("meridian.theme.v1.Metrics");
const oldDescriptors = clone(FileDescriptorSetSchema, descriptors);
for (const file of oldDescriptors.file) for (const message of file.messageType) {
  if (file.package === "meridian.theme.v1" && message.name === "Metrics") {
    message.field = message.field.filter(field => field.number <= 2);
    message.oneofDecl = [];
  }
}
const old = createFileRegistry(oldDescriptors).getMessage("meridian.theme.v1.Metrics");

test("Metrics keeps its file and legacy tags while adding scale, density, and stroke", () => {
  assert.equal(current.file.name, "proto/theme");
  assert.deepEqual(current.fields.map(field => [field.name, field.number]), [
    ["radius_px", 1], ["unit_px", 2], ["spacing_scale_px", 3], ["density_scale", 4], ["stroke_px", 5],
  ]);
  assert.equal(current.fields[2].fieldKind, "list");
  assert.equal(current.fields[2].scalar, 13); // uint32
  assert.deepEqual(current.fields.slice(0, 2).map(field => [field.scalar, field.proto.proto3Optional]),
    [[13, false], [13, false]], "legacy uint32 fields keep their implicit presence");
  assert.equal(current.fields[3].scalar, 1); // double
  assert.equal(current.fields[4].scalar, 13); // uint32
  for (const name of ["density_scale", "stroke_px"]) {
    const field = current.fields.find(field => field.name === name);
    assert.equal(field.proto.proto3Optional, true, `${name} must distinguish absence from explicit zero`);
    assert.equal(field.oneof, undefined, "synthetic scalar presence is not a semantic choice");
  }
});

test("absent Metrics additions preserve old wire bytes and JSON", () => {
  for (const value of [{}, { radiusPx: 12, unitPx: 4 }]) {
    const next = fromJson(current, value), before = fromJson(old, value);
    assert.deepEqual(toBinary(current, next), toBinary(old, before));
    assert.deepEqual([...toBinary(current, next)], Object.keys(value).length ? [8, 12, 16, 4] : [],
      "legacy scalar encoding remains pinned independently of the derived old reader");
    assert.deepEqual(toJson(current, next), toJson(old, before));
    assert.equal(next.densityScale, undefined);
    assert.equal(next.strokePx, undefined);
  }
});

test("old binary readers preserve additive Metrics, including explicit zero stroke", () => {
  const value = fromJson(current, { radiusPx: 12, unitPx: 4,
    spacingScalePx: [0, 2, 6, 12, 18, 24, 36], densityScale: 0.75, strokePx: 0 });
  const wire = toBinary(current, value);
  const legacy = fromBinary(old, wire);
  assert.deepEqual(toJson(old, legacy), { radiusPx: 12, unitPx: 4 });
  const recovered = fromBinary(current, toBinary(old, legacy));
  assert(equals(current, value, recovered));
  assert.equal(recovered.strokePx, 0);
});

test("canonical proto JSON accepts both spellings without erasing scalar presence", () => {
  const snake = fromJson(current, { spacing_scale_px: [0, 4, 8], density_scale: 1, stroke_px: 0 });
  const camel = fromJson(current, { spacingScalePx: [0, 4, 8], densityScale: 1, strokePx: 0 });
  assert(equals(current, snake, camel));
  assert.deepEqual(toJson(current, snake), { spacingScalePx: [0, 4, 8], densityScale: 1, strokePx: 0 });
});
