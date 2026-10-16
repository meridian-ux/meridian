import test from "node:test";
import assert from "node:assert/strict";
import { componentContaining } from "./affordance_migration_probe.mjs";

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
