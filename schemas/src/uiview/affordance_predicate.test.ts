import { create } from "@bufbuild/protobuf";
import { RowFilterSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { expect, it } from "vitest";
import { matchesRowFilter } from "./affordance_predicate.js";

it("executes actual Rust predicates with existing browser String semantics", () => {
  const values = ["", false, 0, -0, 1, 0.000001, 0.0000001, 1e21,
    [1, null, [false, "raw"]], { value: "not disclosed" }];
  const view = new DataView(new ArrayBuffer(8));
  let seed = 0x9e3779b97f4a7c15n;
  for (let index = 0; index < 4096; index++) {
    seed = BigInt.asUintN(64, seed ^ (seed << 13n));
    seed ^= seed >> 7n;
    seed = BigInt.asUintN(64, seed ^ (seed << 17n));
    view.setBigUint64(0, seed);
    const value = view.getFloat64(0);
    if (Number.isFinite(value)) values.push(value);
  }
  for (const value of values) {
    const filter = create(RowFilterSchema, { fieldPath: "nested.value", equals: String(value) });
    expect(matchesRowFilter(filter, { nested: { value } }), String(value)).toBe(true);
    filter.equals += "not equal";
    expect(matchesRowFilter(filter, { nested: { value } })).toBe(false);
  }
});

it("does not normalize identities or equate missing/null with empty text", () => {
  const filter = create(RowFilterSchema, { fieldPath: "state", equals: "é" });
  expect(matchesRowFilter(filter, { state: "e\u0301" })).toBe(false);
  expect(matchesRowFilter(filter, { state: "é" })).toBe(true);
  filter.equals = "";
  expect(matchesRowFilter(filter, {})).toBe(false);
  expect(matchesRowFilter(filter, { state: null })).toBe(false);
  expect(matchesRowFilter(filter, { state: "" })).toBe(true);
});

it("rejects malformed and excessive input rather than executing authored getters", () => {
  const filter = create(RowFilterSchema, { fieldPath: "state", equals: "OPEN" });
  let effects = 0;
  const row = Object.defineProperty({}, "state", { enumerable: true, get() { effects++; return "OPEN"; } });
  expect(() => matchesRowFilter(filter, row)).toThrow();
  expect(effects).toBe(0);
  expect(() => matchesRowFilter(filter, { state: "x".repeat(8 * 1024 * 1024) })).toThrow();
  expect(() => matchesRowFilter(filter, { state: Number.NaN })).toThrow();
  const shadowed = { toString: "authored data is not a callable" };
  expect(() => String(shadowed)).toThrow();
  expect(() => matchesRowFilter(filter, { state: shadowed })).toThrow();
});
