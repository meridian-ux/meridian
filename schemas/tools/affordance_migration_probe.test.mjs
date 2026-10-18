import test from "node:test";
import assert from "node:assert/strict";
import { componentContaining, assertAvailableFields, assertCandidateDeclarations, verifyLegacyConsumerSource } from "./affordance_migration_probe.mjs";
import { readFileSync } from "node:fs";
import { clone, create } from "@bufbuild/protobuf";
import { DescriptorProtoSchema } from "@bufbuild/protobuf/wkt";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { loadImage, REFERENCES } from "./compatibility_line.mjs";

test("frozen legacy source cannot silently become a smaller/new-source compatibility test", () => {
  const source = readFileSync(new URL("../migration/LegacyAffordanceConsumer.ts", import.meta.url), "utf8");
  assert.doesNotThrow(() => verifyLegacyConsumerSource(source));
  assert.throws(() => verifyLegacyConsumerSource(""), /frozen legacy TypeScript source changed/);
  assert.throws(() => verifyLegacyConsumerSource(source.replace("const invalid: number", "const invalid: string")), /frozen legacy/);
});

test("canonical phase checks every frozen declaration and exact candidate field allocation", () => {
  const previous = loadImage(REFERENCES["maintained-0x"]);
  const candidate = loadImage(REFERENCES["v1-candidate"]);
  assert.doesNotThrow(() => assertCandidateDeclarations(previous, candidate));
  for (const corrupt of [
    message => { message.field.find(field => field.name === "label").number = 99; },
    message => { message.field.find(field => field.name === "rpc").typeName = ".meridian.ui.v1.Navigate"; },
    message => { message.field.find(field => field.name === "placement").proto3Optional = false; },
    message => { message.field.find(field => field.name === "refresh_on_success").number = 98; },
    message => { message.field = message.field.filter(field => field.name !== "copy"); },
    message => { message.field.find(field => field.name === "open_view").oneofIndex = 1; },
  ]) {
    const changed = clone(FileDescriptorSetSchema, candidate);
    corrupt(changed.file.find(file => file.name === "proto/interaction.proto").messageType.find(message => message.name === "Affordance"));
    assert.throws(() => assertCandidateDeclarations(previous, changed));
  }
});

test("canonical phase cannot omit a frozen conformance declaration", () => {
  const previous = loadImage(REFERENCES["maintained-0x"]);
  const candidate = loadImage(REFERENCES["v1-candidate"]);
  const conformance = candidate.file.find(file => file.name.startsWith("conformance/") && file.messageType.length);
  assert(conformance, "frozen full-module input must include conformance declarations");
  conformance.messageType.pop();
  assert.throws(() => assertCandidateDeclarations(previous, candidate), /disappeared/);
});

test("candidate allocations reject occupied/reserved names and tags, including duplicate proposals", () => {
  const message = create(DescriptorProtoSchema, { name: "Candidate", field: [{ name: "old", number: 1 }],
    reservedName: ["retired"], reservedRange: [{ start: 5, end: 8 }] });
  assertAvailableFields(message, [["new", 8]]);
  for (const fields of [[["old", 8]], [["new", 1]], [["retired", 8]], [["new", 6]], [["new", 19000]],
    [["new", 0]], [["new", 2 ** 29]], [["new", 8], ["new", 9]], [["new", 8], ["other", 8]]]) {
    assert.throws(() => assertAvailableFields(message, fields));
  }
});

test("the migration SCC includes indirect returning dependencies, not downstream leaves", () => {
  const graph = new Map([
    ["affordance", ["panel", "rpc"]],
    ["panel", ["table", "form"]],
    ["table", ["affordance"]],
    ["form", []], ["rpc", []],
    ["consumer", ["panel"]],
  ]);
  assert.deepEqual(componentContaining(graph, "affordance"), ["affordance", "panel", "table"]);
  graph.set("form", ["affordance"]);
  assert.deepEqual(componentContaining(graph, "affordance"), ["affordance", "form", "panel", "table"]);
});

test("a graph without recursion does not invent a declaration migration", () => {
  const graph = new Map([["affordance", ["rpc"]], ["rpc", []]]);
  assert.deepEqual(componentContaining(graph, "affordance"), ["affordance"]);
});

test("component membership is independent of input ordering and duplicate edges", () => {
  const first = new Map([["b", ["a", "a"]], ["a", ["b"]], ["z", ["a"]]]);
  const second = new Map([["z", ["a"]], ["a", ["b"]], ["b", ["a"]]]);
  assert.deepEqual(componentContaining(first, "a"), componentContaining(second, "a"));
});
