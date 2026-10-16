import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clone, createFileRegistry, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";

const descriptors = fromBinary(FileDescriptorSetSchema, readFileSync(new URL(
  "../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url,
)));
const registry = createFileRegistry(descriptors);
const names = ["UNSPECIFIED", "NEUTRAL", "INFO", "SUCCESS", "WARNING", "DANGER", "ACCENT"];
const value = descriptors.file.find(file => file.name === "proto/value.proto");

test("conversation Tone fields are additive, presence-tracked, and old-reader round-trip safe", () => {
  const old = clone(FileDescriptorSetSchema, descriptors);
  const conversation = old.file.find(file => file.name === "proto/conversation.proto");
  const status = conversation.messageType.find(message => message.name === "Status");
  const tool = conversation.messageType.find(message => message.name === "Block").nestedType.find(message => message.name === "ToolBlock");
  for (const message of [status, tool]) {
    message.field = message.field.filter(field => field.name !== "tone");
    message.oneofDecl = message.oneofDecl.filter(oneof => oneof.name !== "_tone");
  }
  const oldRegistry = createFileRegistry(old);
  for (const [name, tag, legacy] of [["Status", 3, { state: "WORKING", detail: "Working" }],
    ["Block.ToolBlock", 5, { name: "Tool", state: "ERROR", summary: "Failed" }]]) {
    const schema = registry.getMessage(`meridian.ui.v1.${name}`), oldSchema = oldRegistry.getMessage(`meridian.ui.v1.${name}`);
    const field = schema.fields.find(field => field.name === "tone");
    assert.equal(field.number, tag);
    assert.equal(field.enum.typeName, "meridian.ui.v1.Tone");
    assert.equal(field.proto.proto3Optional, true);
    const absent = fromJson(schema, legacy);
    assert.equal(absent.tone, undefined);
    assert.deepEqual(toBinary(schema, absent), toBinary(oldSchema, fromJson(oldSchema, legacy)));
    for (const tone of [0, 1, 2, 3, 4, 5, 6, 999]) {
      const current = fromJson(schema, { ...legacy, tone });
      const bytes = toBinary(schema, current);
      const oldRead = fromBinary(oldSchema, bytes);
      assert.deepEqual(toJson(oldSchema, oldRead), legacy);
      assert.equal(fromBinary(schema, toBinary(oldSchema, oldRead)).tone, tone);
    }
  }
});

test("one shared Tone enum has the six semantic roles and compatible numeric assignments", () => {
  const tone = registry.getEnum("meridian.ui.v1.Tone");
  assert.deepEqual(tone.values.map(entry => [entry.name, entry.number]), names.map((name, number) => [`TONE_${name}`, number]));
  assert.deepEqual(tone.values.map(entry => entry.number), registry.getEnum("meridian.ui.v1.ValueTone").values.map(entry => entry.number));
  const source = readFileSync(new URL("../proto/value.proto", import.meta.url), "utf8");
  for (const [number, name] of names.entries()) assert.match(source, new RegExp(`\\bTONE_${name} = ${number};`));
});

test("ValueTone is deprecated, not removed or silently substituted on existing fields", () => {
  const source = readFileSync(new URL("../proto/value.proto", import.meta.url), "utf8");
  assert.match(source, /enum ValueTone\s*\{\s*option deprecated = true;/);
  const legacy = value.enumType.find(entry => entry.name === "ValueTone");
  assert.equal(legacy.options.deprecated, true);
  assert.deepEqual(legacy.value.map(entry => [entry.name, entry.number]), names.map((name, number) => [`VALUE_TONE_${name}`, number]));
  const option = registry.getMessage("meridian.ui.v1.EnumOption");
  const field = option.fields.find(entry => entry.name === "tone");
  assert.equal(field.number, 3);
  assert.equal(field.enum.typeName, "meridian.ui.v1.ValueTone");
  for (const [number, name] of names.entries()) {
    const original = fromJson(option, { value: "ready", tone: `VALUE_TONE_${name}` });
    const decoded = fromBinary(option, toBinary(option, original));
    assert.equal(decoded.tone, number);
    assert.equal(toJson(option, decoded).tone, number === 0 ? undefined : `VALUE_TONE_${name}`);
  }
  const unknown = fromJson(option, { value: "ready", tone: 999 });
  assert.equal(fromBinary(option, toBinary(option, unknown)).tone, 999);
});
