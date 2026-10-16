#!/usr/bin/env node
// Author wire inputs with the real descriptor schemas. Native and WASM tests
// consume core.json, including its fixed expectations, without re-recording it.
import { createFileRegistry, fromBinary, fromJson, toBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { readFileSync, writeFileSync } from "node:fs";
import { CoreCorpusSchema } from "../../packages/proto-ts/conformance/core_pb.js";
import { FORMATTER_MODES, assertFormatterModes, assertNumberOptions } from "./formatter_modes.mjs";

// Cargo and this writer use the same committed descriptor set. Avoid depending
// on generated JS module resolution in this dependency-light Node tool.
const registry = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(
  new URL("../../crates/core/rust/uiview/proto/gen/meridian_ui_v1.binpb", import.meta.url),
)));
const RpcCallSchema = registry.getMessage("meridian.ui.v1.RpcCall");
const TablePanelSchema = registry.getMessage("meridian.ui.v1.TablePanel");
const GalleryPanelSchema = registry.getMessage("meridian.ui.v1.GalleryPanel");
const ValueDisplaySchema = registry.getMessage("meridian.ui.v1.ValueDisplay");
const FormattedValueSchema = registry.getMessage("meridian.ui.v1.FormattedValue");
const { TemporalDisplay: temporalModes, TemporalPrecision: precisions, PrincipalDisplay: principalModes } = FORMATTER_MODES;
assertFormatterModes(name => registry.getEnum(name));
assertNumberOptions(registry.getMessage("meridian.ui.v1.NumberOptions"));

const wire = (schema, json) => Buffer.from(toBinary(schema, fromJson(schema, json))).toString("base64");
const valueFormat = (name, input, display, nowMs, text, title) => ({
  name, input, display: wire(ValueDisplaySchema, display),
  ...(nowMs === undefined ? {} : { nowMs }),
  expected: wire(FormattedValueSchema, { text, ...(title === undefined ? {} : { title }) }),
});
const instant = Date.parse("2026-03-29T13:45:00Z"); // Authoring constant, not a runtime clock.
const stamp = "2026-03-29T13:45:00Z";
const absoluteStamp = "Mar 29, 2026, 1:45 PM UTC";
const temporalDisplay = (mode = 3, type = 9, precision = 0) => ({ type, temporal: { display: mode, precision } });
const relativeDeltas = [
  ["recent-past", -59_999, "just now"], ["recent-future", 59_999, "just now"],
  ["past-minute", -60_000, "1 minute ago"], ["future-minute", 60_000, "in 1 minute"],
  ["negative-half", -90_000, "1 minute ago"], ["positive-half", 90_000, "in 2 minutes"],
  ["before-hour", -3_599_999, "60 minutes ago"], ["hour", 3_600_000, "in 1 hour"],
  ["before-day", -86_399_999, "24 hours ago"], ["tomorrow", 86_400_000, "tomorrow"],
  ["yesterday", -86_400_000, "yesterday"], ["future-days", 2 * 86_400_000, "in 2 days"],
  ["past-days", -2 * 86_400_000, "2 days ago"], ["next-month", 30 * 86_400_000, "next month"],
  ["last-month", -30 * 86_400_000, "last month"], ["months", 60 * 86_400_000, "in 2 months"],
  ["past-months", -60 * 86_400_000, "2 months ago"], ["next-year", 365 * 86_400_000, "next year"],
  ["last-year", -365 * 86_400_000, "last year"], ["years", 2 * 365 * 86_400_000, "in 2 years"],
  ["grouped-years", 1000 * 365 * 86_400_000, "in 1,000 years"],
];
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

// Fixed expectations shared by native core, the real WASM bridge, and the
// current TypeScript formatter while #50 consolidates the implementations.
const temporalCases = [
  ["offset", "2026-03-29T13:45:30+02:30", "Mar 29, 2026, 11:15 AM UTC"],
  ["next-day", "2026-03-29T23:30:00-02:00", "Mar 30, 2026, 1:30 AM UTC"],
  ["previous-year", "2026-01-01T00:15:00+01:00", "Dec 31, 2025, 11:15 PM UTC"],
  ["leap-day", "2024-03-01T00:15:00+01:00", "Feb 29, 2024, 11:15 PM UTC"],
  ["midnight", "2026-03-29T02:00:00+02:00", "Mar 29, 2026"],
  ["compact-offset", "2026-03-29T13:45:30.123-0230", "Mar 29, 2026, 4:15 PM UTC"],
  ["bad-suffix", "2026-03-29T13:45Zgarbage", "2026-03-29T13:45Zgarbage"],
  ["bad-second", "2026-03-29T13:45:99Z", "2026-03-29T13:45:99Z"],
  ["bad-offset", "2026-03-29T13:45+24:00", "2026-03-29T13:45+24:00"],
  ["unicode-hour", "2026-03-29Té:45Z", "2026-03-29Té:45Z"],
  ["unicode-minute", "2026-03-29T13:中Z", "2026-03-29T13:中Z"],
  ["day-precision", "2026-03-29T23:30:00-02:00", "Mar 29, 2026", { precision: 1 }],
  ["unicode-time", "13:😀Z", "13:😀Z", undefined, 10],
];

const corpus = {
  valueFormats: [
    ...[
      ["text", 1, "2026-03-29T13:45:00Z", {}, "2026-03-29T13:45:00Z"],
      ["multiline", 2, "2026-03-29", {}, "2026-03-29"],
      ["number-string", 4, "2026-03-29", {}, "2026-03-29"],
      ["boolean-string", 5, "2026-03-29", {}, "2026-03-29"],
      ["list-scalars", 7, [false, true], {}, "false, true"],
      ["email-unknown-mode", 13, "Ada <ada@example.com>", { principal: { display: 999 } }, "ada@example.com"],
      ["principal-unknown-mode", 12, "Ada <ada@example.com>", { principal: { display: 999 } }, "Ada"],
      ["invalid-calendar", 9, "2026-02-31T13:45:00Z", {}, "2026-02-31T13:45:00Z"],
      ["zone-free", 9, "2026-03-29T13:45:00", {}, absoluteStamp],
      ["unknown-type", 999, "2026-03-29", {}, "2026-03-29"],
      ["unspecified-type", 0, "2026-03-29", {}, "Mar 29, 2026"],
      ["invalid-date", 8, "1900-02-29", {}, "1900-02-29"],
    ].map(([name, type, input, options, text]) => valueFormat(`fallback-${name}`, input, { type, ...options }, undefined, text)),
    ...[
      ["grouped-default", 4, 12345.625, {}, "12,345.625"],
      ["grouped-fixed", 4, 12345.625, { fractionDigits: 2 }, "12,345.63"],
      ["ungrouped", 4, -12345.625, { omitGroupSeparators: true, fractionDigits: 2 }, "-12345.63"],
      ["fraction-not-grouped", 4, 1.123456, {}, "1.123456"],
      ["integer-grouped", 3, 1234567, {}, "1,234,567"],
      ["negative-zero", 4, 0, {}, "0"],
      ["compact-k", 4, 1234.5, { compact: true, fractionDigits: 2 }, "1.23K"],
      ["compact-m", 4, -1250000, { compact: true }, "-1.25M"],
      ["compact-b", 3, 2500000000, { compact: true, fractionDigits: 0 }, "3B"],
      ["compact-t", 4, 3500000000000, { compact: true }, "3.5T"],
      ["compact-below", 4, 999, { compact: true }, "999"],
      ["compact-boundary", 4, 1000, { compact: true }, "1K"],
      ["compact-precision", 4, 12345.625, { compact: true, fractionDigits: 3 }, "12.346K"],
      ["currency-usd", 16, 12345.625, { currencyCode: "USD", fractionDigits: 2 }, "USD 12,345.63"],
      ["currency-jpy", 16, -12345.625, { currencyCode: "JPY", fractionDigits: 0 }, "JPY -12,346"],
      ["currency-no-invented-precision", 16, 12.5, { currencyCode: "KWD" }, "KWD 12.5"],
      ["currency-compact", 16, 1234500, { currencyCode: "EUR", compact: true, fractionDigits: 2 }, "EUR 1.23M"],
      ["currency-ungrouped", 16, 12345.5, { currencyCode: "USD", omitGroupSeparators: true }, "USD 12345.5"],
      ["currency-lowercase", 16, 12.5, { currencyCode: "usd" }, "12.5"],
      ["currency-control", 16, 12.5, { currencyCode: "US\n" }, "12.5"],
      ["currency-wrong-type", 4, 12345.5, { currencyCode: "USD" }, "12,345.5"],
      ["percent-ratio", 17, 0.125, {}, "12.5%"],
      ["percent-fixed", 17, 0.125, { fractionDigits: 3 }, "12.500%"],
      ["percent-negative-tie", 17, -0.125, { fractionDigits: 0 }, "-13%"],
      ["percent-grouped", 17, 12.625, {}, "1,262.5%"],
      ["percent-ungrouped", 17, 12.625, { omitGroupSeparators: true }, "1262.5%"],
      ["percent-compact", 17, 12.5, { compact: true }, "1.25K%"],
      ["percent-invalid-precision", 17, 0.125, { fractionDigits: 101 }, "12.5%"],
      ["percent-zero", 17, 0, { fractionDigits: 2 }, "0.00%"],
      ["numeric-string-options", 16, "0012.50", { currencyCode: "USD", compact: true, fractionDigits: 0 }, "0012.50"],
      ["null-options", 16, null, { currencyCode: "USD", compact: true }, "—"],
      ["empty-options", 17, "", { compact: true }, "—"],
      ["large-fixed-binary", 4, 1e23, { fractionDigits: 2 }, "99,999,999,999,999,991,611,392.00"],
      ["small-scalar", 4, 1e-7, {}, "0.0000001"],
      ["large-scalar", 4, 1e23, {}, "100,000,000,000,000,000,000,000"],
      ["percent-overflow", 17, 1e308, { fractionDigits: 2 }, "1e+308"],
      ["negative-percent-overflow", 17, -1e308, { compact: true }, "-1e+308"],
      ["compact-rounding-boundary", 4, 999999, { compact: true, fractionDigits: 0 }, "1,000K"],
      ["compact-rounding-ungrouped", 4, 999999, { compact: true, fractionDigits: 0, omitGroupSeparators: true }, "1000K"],
      ["tiny-fixed", 4, 5e-324, { fractionDigits: 100 }, `0.${"0".repeat(100)}`],
    ].map(([name, type, input, number, text]) => valueFormat(`number-${name}`, input, { type, number }, undefined, text)),
    // Fixed expectations for every precision, plus the forward-compatible
    // unknown fallback. Explicit precision must not lose seconds or midnight.
    ...[
      ["date", 8, "2026-03-29T13:45:07Z", ["Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026"]],
      ["timestamp", 9, "2026-03-29T13:45:07Z", [absoluteStamp, "Mar 29, 2026", absoluteStamp, "Mar 29, 2026, 1:45:07 PM UTC", absoluteStamp]],
      ["midnight", 9, "2026-03-29T00:00:00Z", ["Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026, 12:00 AM UTC", "Mar 29, 2026, 12:00:00 AM UTC", "Mar 29, 2026"]],
      ["time", 10, "13:45:07", ["1:45 PM UTC", "1:45 PM UTC", "1:45 PM UTC", "1:45:07 PM UTC", "1:45 PM UTC"]],
      ["time-no-seconds", 10, "13:45", ["1:45 PM UTC", "1:45 PM UTC", "1:45 PM UTC", "1:45 PM UTC", "1:45 PM UTC"]],
      ["calendar-only", 9, "2026-03-29", ["Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026", "Mar 29, 2026"]],
    ].flatMap(([name, type, input, expected]) => [...precisions, 999].map((precision, index) =>
      valueFormat(`precision-${name}-${precision}`, input, temporalDisplay(1, type, precision), undefined, expected[index]))),
    valueFormat("relative-title-seconds", "2026-03-29T13:45:07Z", temporalDisplay(3, 9, 3), instant, "just now", "Mar 29, 2026, 1:45:07 PM UTC"),
    ...[12, 13].flatMap(type => principalModes.map(mode => valueFormat(`principal-${type}-${mode}`,
      "Ada <ada@example.com>", { type, principal: { display: mode } }, instant,
      mode === 2 ? "ada@example.com" : "Ada", mode === 3 ? "ada@example.com" : undefined))),
    valueFormat("principal-default", "Ada <ada@example.com>", { type: 12 }, instant, "Ada"),
    valueFormat("email-default", "Ada <ada@example.com>", { type: 13 }, instant, "ada@example.com"),
    valueFormat("principal-invalid-clock", "Ada <ada@example.com>", { type: 12, principal: { display: 3 } }, "NaN", "Ada", "ada@example.com"),
    ...relativeDeltas.map(([name, delta, text]) => valueFormat(name, stamp, temporalDisplay(), instant - delta, text, absoluteStamp)),
    ...temporalModes.map(mode => valueFormat(`display-mode-${mode}`, stamp, temporalDisplay(mode), instant - 2 * 86_400_000,
      mode < 2 ? absoluteStamp : "in 2 days", mode === 3 ? absoluteStamp : undefined)),
    valueFormat("date-only", "2026-03-29", temporalDisplay(3, 8), Date.parse("2026-03-31T00:00:00Z"), "2 days ago", "Mar 29, 2026"),
    valueFormat("date-offset", "2026-03-29T23:30:00-02:00", temporalDisplay(3, 8), Date.parse("2026-03-31T01:30:00Z"), "yesterday", "Mar 29, 2026"),
    valueFormat("day-precision", "2026-03-29T23:30:00-02:00", temporalDisplay(3, 9, 1), Date.parse("2026-03-31T01:30:00Z"), "yesterday", "Mar 29, 2026"),
    valueFormat("time-has-no-calendar", "13:45:00", temporalDisplay(3, 10), instant, "1:45 PM UTC"),
    ...[undefined, "NaN", "Infinity", "-Infinity", 8_640_000_000_000_001].map((now, index) =>
      valueFormat(`absent-invalid-clock-${index}`, stamp, temporalDisplay(), now, absoluteStamp)),
    valueFormat("epoch-zero-clock", "1970-01-01T00:01:00Z", temporalDisplay(), 0, "in 1 minute", "Jan 1, 1970, 12:01 AM UTC"),
    valueFormat("negative-clock", "1970-01-01T00:00:00Z", temporalDisplay(), -60_000, "in 1 minute", "Jan 1, 1970"),
    valueFormat("fraction-truncation", "1970-01-01T00:00:59.9999Z", temporalDisplay(), 0, "just now", "Jan 1, 1970, 12:00 AM UTC"),
    valueFormat("pre-epoch", "1969-12-31T23:59:59.999Z", temporalDisplay(), 0, "just now", "Dec 31, 1969, 11:59 PM UTC"),
    valueFormat("non-leap-century", "1900-03-01", temporalDisplay(3, 8), Date.parse("1900-02-28T00:00:00Z"), "tomorrow", "Mar 1, 1900"),
    valueFormat("leap-century", "2000-03-01", temporalDisplay(3, 8), Date.parse("2000-02-29T00:00:00Z"), "tomorrow", "Mar 1, 2000"),
    valueFormat("unknown-mode", stamp, temporalDisplay(999), instant, absoluteStamp),
    valueFormat("invalid-stamp", "not-a-timestamp", temporalDisplay(), instant, "not-a-timestamp"),
    valueFormat("null", null, temporalDisplay(), instant, "—"),
    valueFormat("empty", "", temporalDisplay(), instant, "—"),
  ],
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
    ...temporalCases.map(([name, value, expected, temporal, type = 9]) => table(`temporal-${name}`, {
      rowsField: "rows", columns: [{ fieldPath: "value", valueDisplay: { type, ...(temporal ? { temporal } : {}) } }],
    }, { rows: [{ value }] }, [{ raw: { value }, cells: [expected] }])),
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
