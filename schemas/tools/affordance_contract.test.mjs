import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clone, createFileRegistry, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { LEGACY_DEPRECATIONS, LEGACY_MESSAGE_DEPRECATIONS } from "./affordance_migration_probe.mjs";

const descriptors = fromBinary(FileDescriptorSetSchema, readFileSync(new URL(
  "../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url,
)));
const registry = createFileRegistry(descriptors);
const schema = registry.getMessage("meridian.ui.v1.Affordance");

test("obsolete compatibility message types are deprecated, retained, and never confused with canonical panels", () => {
  for (const name of LEGACY_MESSAGE_DEPRECATIONS) {
    const message = registry.getMessage(`meridian.ui.v1.${name}`);
    assert(message, `obsolete type removed before approved cutover: ${name}`);
    assert.equal(message.proto.options?.deprecated, true, name);
    assert(message.fields.length > 0, `${name} fields were removed`);
  }
  for (const name of ["Affordance", "ActionPanel", "Command", "FormPanel", "PanelDescriptor"]) {
    assert.notEqual(registry.getMessage(`meridian.ui.v1.${name}`).proto.options?.deprecated, true, name);
  }
});

test("every retained legacy invocation field is explicitly deprecated without removal", () => {
  for (const [name, fields] of Object.entries(LEGACY_DEPRECATIONS)) for (const fieldName of fields) {
    const message = registry.getMessage(`meridian.ui.v1.${name}`);
    const field = message.fields.find(field => field.name === fieldName);
    assert(field, `legacy field removed before the approved cutover: ${name}.${fieldName}`);
    assert.equal(field.proto.options?.deprecated, true, `${name}.${fieldName}`);
  }
});

test("candidate Affordance preserves existing types and tags with explicit relocated ownership", () => {
  assert.equal(schema.file.proto.name, "proto/interaction.proto");
  const legacy = schema.fields.find(field => field.name === "style");
  assert.equal(legacy.number, 7);
  assert.equal(legacy.enum.typeName, "meridian.ui.v1.AffordanceStyle");
  assert.deepEqual(schema.oneofs.find(oneof => oneof.name === "invoke").fields.map(field => [field.name, field.number]),
    [["uri", 5], ["command", 6], ["rpc", 10], ["navigate", 11], ["open_panel", 12], ["open_view", 13], ["copy", 14]]);
  const file = descriptors.file.find(file => file.name === "proto/interaction.proto");
  const style = file.enumType.find(enumeration => enumeration.name === "AffordanceStyle");
  assert.equal(style.options.deprecated, true);
  assert.deepEqual(style.value.map(value => [value.name, value.number]), [["AFFORDANCE_STYLE_UNSPECIFIED", 0], ["AFFORDANCE_STYLE_PRIMARY", 1], ["AFFORDANCE_STYLE_SECONDARY", 2]]);
  assert.deepEqual(registry.getEnum("meridian.ui.v1.Emphasis").values.map(value => [value.name, value.number]), [["EMPHASIS_UNSPECIFIED", 0], ["EMPHASIS_PRIMARY", 1], ["EMPHASIS_SECONDARY", 2]]);
  for (const [name, tag, type] of [["tone", 8, "Tone"], ["emphasis", 9, "Emphasis"]]) {
    const field = schema.fields.find(field => field.name === name);
    assert.equal(field.number, tag);
    assert.equal(field.enum.typeName, `meridian.ui.v1.${type}`);
    assert.equal(field.proto.proto3Optional, true);
  }
});

test("optional presentation is wire/JSON-additive and old readers preserve explicit zero/future values", () => {
  const old = clone(FileDescriptorSetSchema, descriptors);
  const file = old.file.find(file => file.name === "proto/interaction.proto");
  file.enumType = file.enumType.filter(enumeration => enumeration.name !== "Emphasis");
  file.enumType.find(enumeration => enumeration.name === "AffordanceStyle").options.deprecated = false;
  const message = file.messageType.find(message => message.name === "Affordance");
  message.field = message.field.filter(field => !["tone", "emphasis"].includes(field.name));
  message.oneofDecl = message.oneofDecl.filter(oneof => !["_tone", "_emphasis"].includes(oneof.name));
  const oldSchema = createFileRegistry(old).getMessage(schema.typeName);
  for (const invoke of [{ uri: "/next" }, { command: "raw command" }]) {
    const legacy = { id: "id", label: "Action", description: "Explain", icon: "action", style: 1, ...invoke };
    const expected = toJson(oldSchema, fromJson(oldSchema, legacy));
    const absent = fromJson(schema, legacy);
    assert.equal(absent.tone, undefined);
    assert.equal(absent.emphasis, undefined);
    assert.deepEqual(toBinary(schema, absent), toBinary(oldSchema, fromJson(oldSchema, legacy)));
    for (const tone of [0, 1, 2, 3, 4, 5, 6, 999]) for (const emphasis of [0, 1, 2, 999]) {
      const current = fromJson(schema, { ...legacy, tone, emphasis });
      const oldRead = fromBinary(oldSchema, toBinary(schema, current));
      assert.deepEqual(toJson(oldSchema, oldRead), expected);
      const decoded = fromBinary(schema, toBinary(oldSchema, oldRead));
      assert.equal(decoded.tone, tone);
      assert.equal(decoded.emphasis, emphasis);
      assert.deepEqual(decoded.invoke, current.invoke);
    }
  }
});

test("real frozen pre-v1 readers retain typed invocation bytes without inventing a legacy destination", () => {
  const previous = fromBinary(FileDescriptorSetSchema, readFileSync(new URL("../compat/pre-v1.binpb", import.meta.url)));
  const oldSchema = createFileRegistry(previous).getMessage(schema.typeName);
  for (const invocation of [
    { rpc: { service: "fixture.Service", method: "Delete" } },
    { navigate: { route: "/next" } },
    { openPanel: { panelId: "next" } },
    { openView: "next" },
    { copy: "" },
  ]) {
    const current = fromJson(schema, { id: "action", label: "Action", ...invocation });
    const oldRead = fromBinary(oldSchema, toBinary(schema, current));
    assert.equal(oldRead.invoke.case, undefined);
    const decoded = fromBinary(schema, toBinary(oldSchema, oldRead));
    assert.deepEqual(decoded.invoke, current.invoke);
  }
});
