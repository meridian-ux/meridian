// @vitest-environment jsdom
import { create, fromBinary } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { expect, it, vi } from "vitest";
import { renderPanel, disposePanel, type UiviewWasm } from "../src/uiview/renderer.js";
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const descriptor = () => create(PanelDescriptorSchema, { body: { case: "form", value: {
  mode: 2, submit: { service: "demo.Form", method: "Save", bindings: [{ requestField: "resource", source: { case: "literal", value: "record" } }] },
  prefill: { service: "demo.Form", method: "Get" }, fields: [
    { fieldId: "title", label: "Title", kind: { case: "text", value: { defaultValue: "default", minLength: 2 } } },
    { fieldId: "count", label: "Count", kind: { case: "integer", value: { defaultValue: 2 } } },
    { fieldId: "enabled", label: "Enabled", kind: { case: "boolean", value: { defaultValue: true } } },
    { fieldId: "settings", label: "Settings", kind: { case: "nested", value: { fields: [{ fieldId: "region", label: "Region", kind: { case: "text", value: { defaultValue: "west" } } }] } } },
    { fieldId: "tags", label: "Tags", kind: { case: "keyValueMap", value: {} } },
    { fieldId: "items", label: "Items", kind: { case: "repeated", value: { element: { case: "scalar", value: { fieldId: "item", label: "Item", kind: { case: "text", value: {} } } } } } },
  ],
} } });
const wasm: UiviewWasm = {
  renderTable: () => [], renderTablePanel: () => [], buildPopulateRequest: () => ({}), readPath: () => null, formatLroMetadata: () => "",
  buildRequest: (bytes, context) => { const rpc = fromBinary(RpcCallSchema, bytes); return rpc.method === "Save" ? { resource: "record", ...context.formValues } : {}; },
};
const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
it("prefills typed nested/repeated/map values and submits through the mutation boundary with retry", async () => {
  const root = document.createElement("div");
  let reject = true;
  const invoke = vi.fn(async (_service, method) => {
    if (method === "Get") return { title: "<b>hello</b>", settings: {}, items: ["one"], tags: { team: "core" } };
    if (reject) throw new Error("Save failed"); return {};
  });
  await renderPanel({ root, wasm, descriptor: descriptor(), context, invoker: { invoke }, admission: { mutations: ["demo.Form/Save"] } }); await flush();
  expect(root.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe("<b>hello</b>");
  expect(root.querySelector("b")).toBeNull();
  const submit = () => root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  submit(); submit(); await flush();
  expect(invoke.mock.calls.filter(call => call[1] === "Save")).toHaveLength(1);
  expect(invoke).toHaveBeenLastCalledWith("demo.Form", "Save", { resource: "record", title: "<b>hello</b>", count: 2, enabled: true, settings: { region: "west" }, tags: { team: "core" }, items: ["one"] });
  expect(root.querySelector('[role="alert"]')?.textContent).toBe("Save failed");
  reject = false; submit(); await flush(); expect(root.textContent).toContain("Saved.");
  disposePanel(root); submit(); await flush(); expect(invoke.mock.calls.filter(call => call[1] === "Save")).toHaveLength(2);
});
it("blocks denied submits and keeps defaults after failed prefill", async () => {
  const root = document.createElement("div"); const invoke = vi.fn(async () => { throw new Error("offline"); });
  await renderPanel({ root, wasm, descriptor: descriptor(), context, invoker: { invoke } }); await flush();
  expect(root.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe("default");
  expect(root.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(true);
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true })); await flush(); expect(invoke).toHaveBeenCalledTimes(1);
  expect(root.textContent).toContain("offline");
});
it("validates typed input before transport and formats read-only values", async () => {
  const root = document.createElement("div"); const panel = descriptor();
  if (panel.body.case !== "form") throw new Error(); panel.body.value.prefill = undefined;
  const invoke = vi.fn(async () => ({}));
  await renderPanel({ root, wasm, descriptor: panel, context, invoker: { invoke }, admission: "unrestricted" });
  root.querySelector<HTMLInputElement>('[name="title"]')!.value = "x";
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true })); await flush();
  expect(invoke).not.toHaveBeenCalled(); expect(root.textContent).toContain("invalid length");
  panel.body.value.mode = 1; panel.body.value.fields[2].display = { $typeName: "meridian.ui.v1.ValueDisplay", type: ValueType.BOOLEAN, options: { case: undefined } };
  await renderPanel({ root, wasm, descriptor: panel, context, invoker: { invoke } });
  expect(root.textContent).toContain("Yes"); expect(root.querySelector("input")).toBeNull();
});
