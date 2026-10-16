import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { buildSubmissionRequest as coreSubmission } from "../../../schemas/src/uiview/generated/meridian_uiview.js";
import { buildSubmissionRequest } from "../src/action_request.js";

const field = (id: string, path = "") => create(FormFieldSchema, { fieldId: id, requestField: path });
const call = () => create(RpcCallSchema, { service: "demo.Inputs", method: "Submit" });

describe("React submission contract (shared-core cases)", () => {
  for (const kind of ["form", "lro"] as const) it.each([
    { name: "empty", value: "" }, { name: "zero", value: 0 }, { name: "false", value: false }, { name: "null", value: null },
    { name: "raw map", value: JSON.parse('{"__proto__":{"raw":true},"decimal":"001.20"}') },
    { name: "raw list", value: [null, 0, false, "001.20"] },
  ])(`${kind}: agrees with the actual bundled Rust/WASM core for $name`, ({ value }) => {
    const fields = [field("a.b", "mapped.value"), field("title"), create(FormFieldSchema, {
      fieldId: "nested", requestField: "config", kind: { case: "nested", value: { fields: [field("zero", "data.zero"), field("flag", "data.flag")] } },
    }), field("items"), field("missing")];
    const rpc = create(RpcCallSchema, { service: "s", method: "m", bindings: [
      { requestField: "title", source: { case: "literal", value: "bound" } },
      { requestField: "copied", source: { case: "formField", value: "a.b" } },
      { requestField: "owner", source: { case: "rowField", value: "id" } },
      { requestField: "tenant", source: { case: "selectionKey", value: "tenant" } },
    ] });
    const values = { "a.b": value, title: "raw", nested: { zero: 0, flag: false }, items: [{ "raw.key": "001.20" }, 0], hidden: "not sent" };
    const descriptor = create(PanelDescriptorSchema, { body: kind === "form" ? { case: "form", value: { fields, submit: rpc } }
      : { case: "lro", value: { inputs: fields, start: rpc } } });
    expect(buildSubmissionRequest(rpc, fields, values, { tenant: "live" }, kind, { id: 0 })).toEqual(coreSubmission(
      toBinary(PanelDescriptorSchema, descriptor),
      { currentResourcePath: "", uiIdentity: null, selectedRow: { id: 0 }, formValues: {}, selections: { tenant: "live" } }, values));
  });

  it("keeps literal Form IDs, ignores LRO paths, and gives explicit bindings precedence", () => {
    const rpc = call();
    rpc.bindings = create(RpcCallSchema, { bindings: [
      { requestField: "title", source: { case: "literal", value: "bound" } },
      { requestField: "leaked", source: { case: "formField", value: "secret" } },
    ] }).bindings;
    const values = { "a.b": false, title: "raw", nested: { child: 0 }, secret: "do not send" };
    expect(buildSubmissionRequest(rpc, [field("a.b", "ignored.path"), field("title"), field("nested")], values, {}, "form"))
      .toEqual({ "a.b": false, title: "bound", nested: { child: 0 } });
    expect(values).toEqual({ "a.b": false, title: "raw", nested: { child: 0 }, secret: "do not send" });
  });

  it("maps all nested LRO paths while preserving raw lists/maps, false and missing nulls", () => {
    const outer = create(FormFieldSchema, { fieldId: "outer", requestField: "config", kind: { case: "nested", value: { fields: [
      { fieldId: "middle", requestField: "inner", kind: { case: "nested", value: { fields: [
        { fieldId: "value", requestField: "data.value" },
      ] } } },
    ] } } });
    const rpc = call(); rpc.bindings = create(RpcCallSchema, { bindings: [
      { requestField: "config.inner.data.value", source: { case: "literal", value: "old" } },
    ] }).bindings;
    expect(buildSubmissionRequest(rpc, [outer, field("items"), field("missing")],
      { outer: { middle: { value: false } }, items: [{ "raw.key": "001.20" }, 0] }, {}, "lro"))
      .toEqual({ config: { inner: { data: { value: false } } }, items: [{ "raw.key": "001.20" }, 0], missing: null });
  });

  it("resolves only declared top-level formField sources, including nested bindings", () => {
    const rpc = create(RpcCallSchema, { service: "s", method: "m", bindings: [{ requestField: "scope", source: { case: "nested", value: { fields: [
      { requestField: "picked", source: { case: "formField", value: "chosen" } },
      { requestField: "tenant", source: { case: "selectionKey", value: "tenant" } },
      { requestField: "owner", source: { case: "rowField", value: "id" } },
      { requestField: "hidden", source: { case: "formField", value: "hidden" } },
    ] } } }] });
    expect(buildSubmissionRequest(rpc, [field("chosen")], { chosen: 0, hidden: "secret" }, { tenant: "live" }, "form", { id: false }))
      .toEqual({ scope: { picked: 0, tenant: "live", owner: false }, chosen: 0 });
  });

  it.each(["form", "lro"] as const)("%s shares binding and automatic-field copy work", kind => {
    const rpc = create(RpcCallSchema, { service: "s", method: "m", bindings: [
      { requestField: "scope", source: { case: "literal", value: "x".repeat(400_000) } },
    ] });
    expect(() => buildSubmissionRequest(rpc, [field("text")], { text: "x".repeat(400_000) }, {}, kind)).toThrow();
  });

  it.each(["form", "lro"] as const)("%s rejects unsafe, duplicate, cyclic, and non-JSON values without partial results", kind => {
    expect(() => buildSubmissionRequest(call(), [field("__proto__")], {}, {}, kind)).toThrow();
    expect(() => buildSubmissionRequest(call(), [field("x"), field("x")], { x: "raw" }, {}, kind)).toThrow();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const value of [cyclic, undefined, Infinity, new Date()]) {
      expect(() => buildSubmissionRequest(call(), [field("x")], { x: value }, {}, kind)).toThrow();
    }
  });

  it("rejects unsafe and excessive LRO request paths before constructing them", () => {
    for (const path of ["__proto__.bad", "config..bad", Array(66).fill("deep").join(".")]) {
      expect(() => buildSubmissionRequest(call(), [field("x", path)], { x: 0 }, {}, "lro")).toThrow();
    }
  });
});
