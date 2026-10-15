#!/usr/bin/env node
// Author wire inputs with the real descriptor schemas. Native and WASM tests
// consume core.json, including its fixed expectations, without re-recording it.
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { readFileSync, writeFileSync } from "node:fs";
import { CoreCorpusSchema } from "../../packages/proto-ts/conformance/core_pb.js";

// Cargo and this writer use the same committed descriptor set. Avoid depending
// on generated JS module resolution in this dependency-light Node tool.
const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(
  new URL("../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url),
)));
const RpcCallSchema = registry.getMessage("meridian.ui.v1.RpcCall");
const TablePanelSchema = registry.getMessage("meridian.ui.v1.TablePanel");
const GalleryPanelSchema = registry.getMessage("meridian.ui.v1.GalleryPanel");

const wire = (schema, json) => Buffer.from(toBinary(schema, fromJson(schema, json))).toString("base64");
const request = (name, bindings, context, expected) => ({
  name, rpc: wire(RpcCallSchema, { service: "test.Core", method: "Call", bindings }), context, expected,
});
const bindings = [
  { requestField: "name", context: 1 },
  { requestField: "identity", context: 2 },
  { requestField: "row.id", rowField: "nested.id" },
  { requestField: "enabled", formField: "enabled" },
  { requestField: "count", formField: "count" },
  { requestField: "scope", selectionKey: "year" },
  { requestField: "label", literal: "literal" },
  { requestField: "child", nested: { fields: [{ requestField: "limit", literal: "50" }] } },
  { requestField: "missing", rowField: "absent" },
  { requestField: "signal", signal: "brush" },
];
const table = (name, shape, response, expected) => ({ name, table: wire(TablePanelSchema, shape), response, expected });
const gallery = (name, shape, response, expected) => ({ name, gallery: wire(GalleryPanelSchema, shape), response, expected });
const tableShape = {
  rowsField: "result.rows",
  columns: [
    { header: "Name", fieldPath: "name" },
    { header: "Active", fieldPath: "active", valueDisplay: { type: 5 } },
    { header: "Cost", fieldPath: "cost", valueDisplay: { type: 4, number: { fractionDigits: 2 } } },
    { header: "Absent", fieldPath: "absent" },
    { header: "Declared absent", fieldPath: "absent", valueDisplay: { type: 1 } },
  ],
};
const row = { name: "Ada", active: false, cost: -1.125, nested: { count: 0 } };
const card = { titleField: "name", subtitleField: "active", subtitleDisplay: { type: 5 }, iconField: "icon", statusField: "status", hrefField: "href", actionLabelField: "action" };
const cardRow = { name: "Alpha", active: false, icon: "repo", status: "ready", href: "/alpha", action: "Open" };
const renderedCard = { raw: cardRow, title: "Alpha", subtitle: "No", icon: "repo", status: "ready", href: "/alpha", action_label: "Open" };

const corpus = {
  paths: [
    { name: "nested", input: { a: { b: 7 } }, path: "a.b", expected: 7 },
    { name: "false", input: { a: false }, path: "a", expected: false },
    { name: "zero", input: { a: 0 }, path: "a", expected: 0 },
    { name: "missing", input: { a: {} }, path: "a.b.c", expected: null },
    { name: "scalar-intermediate", input: { a: 7 }, path: "a.b", expected: null },
    { name: "array-not-an-object", input: ["a"], path: "0", expected: null },
    { name: "empty-path", input: { a: [false, 0, null] }, path: "", expected: { a: [false, 0, null] } },
  ],
  requests: [
    request("all-bridge-sources", bindings, {
      currentResourcePath: "resources/1", uiIdentity: { name: "human/ada" },
      selectedRow: { nested: { id: 0 } }, formValues: { enabled: false, count: 0 }, selections: { year: 2026 },
    }, { name: "resources/1", identity: { name: "human/ada" }, row: { id: 0 }, enabled: false, count: 0, scope: 2026, label: "literal", child: { limit: "50" } }),
    request("absent-context-omits-sources", bindings, {}, { label: "literal", child: { limit: "50" } }),
    request("null-and-empty-values", [
      { requestField: "absent", formField: "nil" }, { requestField: "text", formField: "text" },
      { requestField: "values", formField: "values" }, { requestField: "scope", selectionKey: "scope" },
    ], { formValues: { nil: null, text: "", values: [] }, selections: { scope: false } }, { text: "", values: [], scope: false }),
    request("ordered-path-overwrite", [
      { requestField: "a", literal: "old" }, { requestField: "a.b", literal: "new" },
      { requestField: "a.b", literal: "last" },
    ], {}, { a: { b: "last" } }),
    request("unknown-context-and-unset-source", [
      { requestField: "unknown", context: 999 }, { requestField: "unset" }, { requestField: "", literal: "ignored" },
    ], {}, {}),
    request("unbound-call", [], {}, {}),
  ],
  tables: [
    table("populated-nested-rows", tableShape, { result: { rows: [row] } }, [{ raw: row, cells: ["Ada", "No", "-1.13", "", "—"] }]),
    table("empty", tableShape, { result: { rows: [] } }, []),
    table("missing-rows", tableShape, {}, []),
    table("wrong-rows-shape", tableShape, { result: { rows: {} } }, []),
    table("scalar-row", { rowsField: "rows", columns: [{ fieldPath: "" }] }, { rows: [0, false] }, [{ raw: 0, cells: ["0"] }, { raw: false, cells: ["false"] }]),
  ],
  galleries: [
    gallery("all-slots", { rowsField: "rows", card }, { rows: [cardRow] }, [renderedCard]),
    gallery("empty", { rowsField: "rows", card }, { rows: [] }, []),
    gallery("missing-card", { rowsField: "rows" }, { rows: [cardRow] }, [{ raw: cardRow, title: "", subtitle: "", icon: "", status: "", href: "", action_label: "" }]),
    gallery("missing-and-scalar-slots", { rowsField: "rows", card: { titleField: "nested.value", subtitleField: "absent" } }, { rows: [{ nested: { value: 0 } }] }, [{ raw: { nested: { value: 0 } }, title: "0", subtitle: "", icon: "", status: "", href: "", action_label: "" }]),
  ],
  metadata: [
    { name: "state-and-status", input: { state: "RUNNING", status_message: "Working" }, expected: "[RUNNING] Working" },
    { name: "state-only", input: { state: "DONE" }, expected: "[DONE] " },
    { name: "status-only", input: { status_message: "Waiting" }, expected: "Waiting" },
    { name: "fallback", input: { progress: 0 }, expected: '{"progress":0}' },
    { name: "null", input: null, expected: "null" },
  ],
  budgets: [
    { name: "rate-and-total", maxBytes: 8, maxRate: 5, frames: [
      { bytes: 3, now: 100, expected: 0 }, { bytes: 3, now: 500, expected: 2 },
      { bytes: 3, now: 1101, expected: 0 }, { bytes: 3, now: 1102, expected: 1 },
    ] },
    { name: "invalid-clock-and-recovery", maxBytes: 8, maxRate: 8, frames: [
      { bytes: 1, now: "NaN", expected: 3 }, { bytes: 1, now: "Infinity", expected: 3 },
      { bytes: 1, now: -1, expected: 3 }, { bytes: 1, now: 10, expected: 0 },
      { bytes: 1, now: 9, expected: 3 }, { bytes: 1, now: 11, expected: 0 },
    ] },
    { name: "rolling-bucket-edge", maxBytes: 20, maxRate: 5, frames: [
      { bytes: 5, now: 0, expected: 0 }, { bytes: 1, now: 1000, expected: 2 },
      { bytes: 5, now: 1001, expected: 0 },
    ] },
    { name: "zero-selects-defaults", maxBytes: 0, maxRate: 0, frames: [
      { bytes: 1048576, now: 0, expected: 0 }, { bytes: 1, now: 1, expected: 2 },
      { bytes: 1, now: 1001, expected: 0 },
    ] },
  ],
};
const target = new URL("../conformance/core.json", import.meta.url);
// Validate bytes, field names, and special floating-point values against the
// generated test-only envelope before writing or checking its JSON projection.
fromJson(CoreCorpusSchema, corpus);
const output = `${JSON.stringify(corpus, null, 2)}\n`;
if (process.argv.includes("--write")) writeFileSync(target, output);
else if (readFileSync(target, "utf8") !== output) {
  throw new Error("core.json is stale; run node schemas/tools/write_core_corpus.mjs --write and review expectations");
}
