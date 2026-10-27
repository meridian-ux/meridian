import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { FieldBindingSchema, RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { actionRequestJson, boundedActionRequest, boundedJson, hasDynamicBindings } from "../src/action_request.js";

const rowCall = () => create(RpcCallSchema, { service: "demo.Rows", method: "Run", bindings: [
  { requestField: "payload", source: { case: "rowField", value: "payload" } },
] });

describe("bounded React action assembly", () => {
  it("bounds protobuf descriptor bytes without invoking custom hooks or admitting raw request bytes", () => {
    const bytes = new Uint8Array([0, 127, 255]);
    let callbacks = 0;
    const trap = () => { callbacks++; throw Error("Do not execute descriptor hooks"); };
    Object.defineProperty(bytes, Symbol.iterator, { get: trap });
    Object.defineProperty(bytes, "length", { get: trap });
    Object.defineProperty(bytes, "toJSON", { get: trap });
    expect(JSON.parse(boundedJson({ wire: bytes }))).toEqual({ wire: [0, 127, 255] });
    expect(() => boundedJson({ wire: new Uint8Array(100_000) })).toThrow();
    expect(() => boundedActionRequest(rowCall(), {}, { payload: bytes })).toThrow();
    expect(callbacks).toBe(0);
  });
  it("preserves raw JSON, prototype-looking data keys, and source ownership", () => {
    const data = JSON.parse('{"__proto__":{"raw":true},"zero":0,"no":false,"empty":"","list":[null,2]}');
    const row = { payload: data };
    const call = rowCall();
    call.bindings.push(create(FieldBindingSchema, { requestField: "payload.extra.id", source: { case: "literal", value: "new" } }));
    const request = boundedActionRequest(call, {}, row);
    expect(request).toEqual({ payload: { ...data, extra: { id: "new" } } });
    expect(Object.hasOwn(request.payload as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(request.payload)).toBe(Object.prototype);
    expect(data.extra).toBeUndefined();
    (request.payload as { list: unknown[] }).list.push(3);
    expect(data.list).toEqual([null, 2]);
    expect(({} as { raw?: boolean }).raw).toBeUndefined();
  });

  it.each(["__proto__.polluted", "constructor.prototype.polluted", "scope..id", ".scope", "scope."])("rejects the entire request for %s", path => {
    const call = rowCall();
    call.bindings.push(create(FieldBindingSchema, { requestField: path, source: { case: "literal", value: "bad" } }));
    expect(() => boundedActionRequest(call, {}, { payload: { safe: true } })).toThrow("Request construction rejected");
    expect(actionRequestJson(call, {}, { payload: { safe: true } })).toBeUndefined();
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });

  it("preserves authored empty literals and false/zero row values but omits missing scopes", () => {
    const call = create(RpcCallSchema, { service: "s", method: "m", bindings: [
      { requestField: "scope", source: { case: "nested", value: { fields: [
        { requestField: "zero", source: { case: "rowField", value: "zero" } },
        { requestField: "no", source: { case: "rowField", value: "no" } },
        { requestField: "empty", source: { case: "literal", value: "" } },
        { requestField: "unset", source: { case: "selectionKey", value: "unset" } },
        { requestField: "picked", source: { case: "selectionKey", value: "picked" } },
      ] } } },
    ] });
    expect(boundedActionRequest(call, { picked: "tenant", unset: "" }, { zero: 0, no: false }))
      .toEqual({ scope: { zero: 0, no: false, empty: "", picked: "tenant" } });
  });

  it("charges repeated borrowed values cumulatively before making each copy", () => {
    const call = rowCall();
    call.bindings.push(...Array.from({ length: 3 }, (_, i) => create(FieldBindingSchema, {
      requestField: `copy${i}`, source: { case: "rowField", value: "payload" },
    })));
    expect(() => boundedActionRequest(call, {}, { payload: "x".repeat(200_000) })).toThrow();
  });

  it("does not repeatedly clone a borrowed parent on overlapping writes", () => {
    const call = rowCall();
    call.bindings.push(...Array.from({ length: 500 }, (_, i) => create(FieldBindingSchema, {
      requestField: `payload.extra.key${i}`, source: { case: "literal", value: "v" },
    })));
    const payload = { text: "x".repeat(300_000) };
    const request = boundedActionRequest(call, {}, { payload });
    expect(Object.keys((request.payload as { extra: object }).extra)).toHaveLength(500);
    expect(payload).toEqual({ text: "x".repeat(300_000) });
  });

  it.each(["cycle", "deep", "large", "sparse", "nonfinite", "opaque", "getter", "toJSON"])("rejects %s raw input without executing data callbacks", mode => {
    let callbacks = 0;
    let payload: unknown;
    if (mode === "cycle") { const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; payload = cyclic; }
    if (mode === "deep") { payload = 0; for (let i = 0; i < 70; i++) payload = { next: payload }; }
    if (mode === "large") payload = "\0".repeat(800_000);
    if (mode === "sparse") payload = new Array(1_000_000);
    if (mode === "nonfinite") payload = Infinity;
    if (mode === "opaque") payload = new Date();
    if (mode === "getter") payload = Object.defineProperty({}, "value", { enumerable: true, get: () => { callbacks++; return 1; } });
    if (mode === "toJSON") payload = { toJSON: () => { callbacks++; return {}; } };
    expect(() => boundedActionRequest(rowCall(), {}, { payload })).toThrow();
    expect(callbacks).toBe(0);
  });

  it("bounds declarations and cyclic nested bindings and disables SSR eligibility", () => {
    const field = create(FieldBindingSchema, { requestField: "nested", source: { case: "nested", value: {} } });
    if (field.source.case !== "nested") throw new Error("Wrong fixture source");
    field.source.value.fields.push(field);
    const call = rowCall();
    call.bindings = [field];
    expect(() => boundedActionRequest(call, {})).toThrow();
    expect(hasDynamicBindings(call.bindings)).toBe(true);
    call.bindings = [create(FieldBindingSchema, { requestField: "x".repeat(65_537), source: { case: "literal", value: "small" } })];
    expect(actionRequestJson(call, {})).toBeUndefined();
    expect(boundedJson({ safe: 0 })).toBe('{"safe":0}');
    expect(() => boundedJson({ unsafe: field })).toThrow();
  });

  it("uses only own data fields, including selection lookup", () => {
    const call = create(RpcCallSchema, { service: "s", method: "m", bindings: [
      { requestField: "scope", source: { case: "selectionKey", value: "inherited" } },
      { requestField: "row", source: { case: "rowField", value: "inherited" } },
    ] });
    expect(boundedActionRequest(call, Object.create({ inherited: "bad" }), Object.create({ inherited: "bad" }))).toEqual({});
  });

  it("shares the budget with subject defaults and bounds their declared names", () => {
    const call = rowCall();
    expect(actionRequestJson(call, {}, { payload: "x".repeat(400_000) }, { id: "s".repeat(400_000) })).toBeUndefined();
    expect(actionRequestJson(call, {}, {}, { ["n".repeat(65_537)]: "id" })).toBeUndefined();
    expect(actionRequestJson(call, {}, {}, JSON.parse('{"__proto__":"id"}'))).toBeUndefined();
    expect(boundedActionRequest(undefined, {}, undefined, { "literal.id": "subject" })).toEqual({ "literal.id": "subject" });
  });

  it("omits explicitly unset protobuf descriptor properties but rejects undefined RPC data", () => {
    expect(boundedJson({ optional: undefined, present: false })).toBe('{"present":false}');
    expect(() => boundedActionRequest(rowCall(), {}, { payload: { optional: undefined } })).toThrow();
    let deep: unknown = 0;
    for (let i = 0; i < 520; i++) deep = { nested: deep };
    expect(() => boundedJson(deep)).toThrow();
  });
});
