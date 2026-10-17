import test from "node:test";
import assert from "node:assert/strict";
import { componentContaining, assertAvailableFields } from "./affordance_migration_probe.mjs";
import { create } from "@bufbuild/protobuf";
import { DescriptorProtoSchema } from "@bufbuild/protobuf/wkt";

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
