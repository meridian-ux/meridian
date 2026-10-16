// @vitest-environment jsdom
import { create, fromBinary, fromJson, toBinary, type JsonObject } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { ValueTone, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
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
it("keeps anonymous scalar list elements valid and preserves raw false", async () => {
  const p = descriptor(); if (p.body.case !== "form") throw new Error("form fixture");
  p.body.value.prefill = undefined;
  p.body.value.fields = [fromJson(FormFieldSchema, { fieldId: "items", repeated: { minItems: 1, scalar: { boolean: {} } } })];
  const root = document.createElement("main"), invoke = vi.fn(async () => ({}));
  await renderPanel({ root, wasm, descriptor: p, context, invoker: { invoke }, admission: "unrestricted" });
  try {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush();
    expect(invoke).toHaveBeenCalledWith("demo.Form", "Save", { resource: "record", items: [false] });
  } finally { disposePanel(root); }
});
const kinds: Record<string, JsonObject> = { integer: {}, number: {}, boolean: {}, text: {}, masked: {},
  enumSelection: { allowedValues: ["one"], defaultValue: "one" }, nested: {},
  repeated: { scalar: { fieldId: "item", text: {} } }, keyValueMap: {} };
it.each(Object.keys(kinds))("rejects an empty object-field ID for %s before transport", async kind => {
  const p = descriptor(); if (p.body.case !== "form") throw new Error("form fixture");
  p.body.value.prefill = undefined;
  p.body.value.fields = [fromJson(FormFieldSchema, { label: "Missing identity", [kind]: kinds[kind] })];
  const root = document.createElement("main"), invoke = vi.fn(async () => ({}));
  await renderPanel({ root, wasm, descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, p)), context, invoker: { invoke }, admission: "unrestricted" });
  try {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("nonempty");
    expect(invoke).not.toHaveBeenCalled();
  } finally { disposePanel(root); }
});
it.each(["root", "nested", "repeated"])("rejects duplicate field IDs at the %s object boundary", async shape => {
  const p = descriptor(); if (p.body.case !== "form") throw new Error("form fixture");
  p.body.value.prefill = undefined;
  const duplicate = [{ fieldId: "same", text: {} }, { fieldId: "same", text: {} }];
  p.body.value.fields = (shape === "root" ? duplicate : [{ fieldId: "outer", ...(shape === "nested"
    ? { nested: { fields: duplicate } } : { repeated: { minItems: 1, object: { fields: duplicate } } }) }])
    .map(field => fromJson(FormFieldSchema, field));
  const root = document.createElement("main"), invoke = vi.fn(async () => ({}));
  await renderPanel({ root, wasm, descriptor: p, context, invoker: { invoke }, admission: "unrestricted" });
  try {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("unique");
    expect(invoke).not.toHaveBeenCalled();
  } finally { disposePanel(root); }
});
it("reports malformed patterns through shared validation and rejects forged DOM enum options", async () => {
  for (const field of [fromJson(FormFieldSchema, { fieldId: "value", text: { defaultValue: "raw", pattern: "[" } }),
    fromJson(FormFieldSchema, { fieldId: "value", enumSelection: { allowedValues: ["one"], defaultValue: "one" } })]) {
    const p = descriptor(); if (p.body.case !== "form") throw new Error("form fixture");
    p.body.value.prefill = undefined; p.body.value.fields = [field];
    const root = document.createElement("main"), invoke = vi.fn(async () => ({}));
    await renderPanel({ root, wasm, descriptor: p, context, invoker: { invoke }, admission: "unrestricted" });
    try {
      const select = root.querySelector("select");
      if (select) { const option = document.createElement("option"); option.value = "forged"; select.append(option); select.value = "forged"; }
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush();
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(select ? "select an allowed value" : "invalid pattern");
      expect(invoke).not.toHaveBeenCalled();
    } finally { disposePanel(root); }
  }
});
const lroDescriptor = () => create(PanelDescriptorSchema, { body: { case: "lro", value: {
  start: { service: "demo.Lro", method: "Start" }, inputs: [
    { fieldId: "enabled", requestField: "config.enabled", label: "Enabled", kind: { case: "boolean", value: { defaultValue: false } } },
    { fieldId: "notes", label: "Notes", display: { type: ValueType.MULTILINE_TEXT }, kind: { case: "text", value: { defaultValue: "first\nsecond", minLength: 1 } } },
    { fieldId: "nested", requestField: "settings", kind: { case: "nested", value: { fields: [
      { fieldId: "amount", requestField: "limit.amount", kind: { case: "number", value: { defaultValue: 12.5 } } },
    ] } } },
  ],
} } });
it("collects typed LRO inputs and maps request paths without formatting raw values", async () => {
  const root = document.createElement("div");
  const invoke = vi.fn(async () => ({ name: "operations/test", done: true }));
  await renderPanel({ root, wasm, descriptor: lroDescriptor(), context, invoker: { invoke }, admission: "unrestricted" });
  expect(root.querySelector("textarea")?.value).toBe("first\nsecond");
  root.querySelector<HTMLButtonElement>("button")!.click(); await flush();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("demo.Lro", "Start", {
    config: { enabled: false }, notes: "first\nsecond", settings: { limit: { amount: 12.5 } },
  });
  expect(root.textContent).toContain("Done."); disposePanel(root);
});
it("validates LRO inputs before mutation and permits a corrected retry", async () => {
  const root = document.createElement("div"); const invoke = vi.fn(async () => ({ done: true }));
  await renderPanel({ root, wasm, descriptor: lroDescriptor(), context, invoker: { invoke }, admission: "unrestricted" });
  const notes = root.querySelector("textarea")!; notes.value = "";
  const run = root.querySelector<HTMLButtonElement>("button")!; run.click(); await flush();
  expect(invoke).not.toHaveBeenCalled(); expect(root.textContent).toContain("invalid length");
  notes.value = "corrected"; run.click(); await flush(); expect(invoke).toHaveBeenCalledTimes(1); disposePanel(root);
});
it("ignores an LRO start completion after the panel is disposed", async () => {
  const root = document.createElement("div"); let complete!: (value: object) => void;
  const invoke = vi.fn(() => new Promise<object>(resolve => { complete = resolve; }));
  await renderPanel({ root, wasm, descriptor: lroDescriptor(), context, invoker: { invoke }, admission: "unrestricted" });
  const run = root.querySelector<HTMLButtonElement>("button")!; run.click(); await flush();
  expect(invoke).toHaveBeenCalledTimes(1); disposePanel(root);
  const previous = root.textContent; complete({ name: "operations/stale", done: false }); await flush();
  expect(root.textContent).toBe(previous); expect(invoke).toHaveBeenCalledTimes(1); expect(run.disabled).toBe(true);
});
it("keeps the LRO mutation admission gate authoritative", async () => {
  const root = document.createElement("div"); const invoke = vi.fn(async () => ({ done: true }));
  await renderPanel({ root, wasm, descriptor: lroDescriptor(), context, invoker: { invoke } });
  root.querySelector<HTMLButtonElement>("button")!.click(); await flush();
  expect(invoke).not.toHaveBeenCalled(); expect(root.textContent).toContain("Failed:"); disposePanel(root);
});
it("retries LRO options and ignores an options response after disposal", async () => {
  const panel = lroDescriptor(); if (panel.body.case !== "lro") throw new Error();
  panel.body.value.inputs = [create(FormFieldSchema, { fieldId: "region", kind: { case: "enumSelection", value: {
    optionsSource: { service: "demo.Options", method: "List", optionsField: "items", valueField: "token", labelField: "label" },
  } } })];
  const root = document.createElement("div"); let complete!: (value: object) => void;
  const invoke = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(() => new Promise<object>(resolve => { complete = resolve; }));
  await renderPanel({ root, wasm, descriptor: panel, context, invoker: { invoke }, admission: "unrestricted" }); await flush();
  expect(root.textContent).toContain("offline");
  const buttons = Array.from(root.querySelectorAll("button"));
  expect(buttons[0].disabled).toBe(true); buttons.find(button => button.textContent === "Retry inputs")!.click(); await flush();
  expect(invoke).toHaveBeenCalledTimes(2); disposePanel(root); const previous = root.textContent;
  complete({ items: [{ token: "west", label: "Western region" }] }); await flush();
  expect(root.textContent).toBe(previous); expect(root.querySelector("select")).toBeNull();
});
it("rejects unsafe LRO request paths and excessive repeated defaults without invoking", async () => {
  for (const excessive of [false, true]) {
    const panel = lroDescriptor(); if (panel.body.case !== "lro") throw new Error();
    if (excessive) panel.body.value.inputs = [create(FormFieldSchema, { fieldId: "huge", kind: { case: "repeated", value: {
      minItems: 0xffffffff, element: { case: "scalar", value: { kind: { case: "boolean", value: {} } } },
    } } })];
    else panel.body.value.inputs[0].requestField = "__proto__.polluted";
    const root = document.createElement("div"); const invoke = vi.fn(async () => ({ done: true }));
    await renderPanel({ root, wasm, descriptor: panel, context, invoker: { invoke }, admission: "unrestricted" });
    root.querySelector<HTMLButtonElement>("button")!.click(); await flush();
    expect(invoke).not.toHaveBeenCalled(); expect(root.textContent).toContain(excessive ? "Default expansion" : "Unsafe form request path");
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false); disposePanel(root);
  }
});
it("preserves enum labels, tones, fallback options, and raw submissions", async () => {
  for (const labeled of [true, false]) {
    const root = document.createElement("div");
    const panel = create(PanelDescriptorSchema, { body: { case: "form", value: {
      mode: 2, submit: { service: "demo.Form", method: "Save" }, fields: [
        { fieldId: "region", kind: { case: "enumSelection", value: {
          defaultValue: "west", allowedValues: ["west", "east", "other"],
          options: labeled ? [{ value: "west", label: "Western region", tone: ValueTone.SUCCESS }, { value: "east", tone: ValueTone.DANGER }, { value: "other", tone: 99 as ValueTone }] : [],
        } } },
      ],
    } } });
    const invoke = vi.fn(async () => ({}));
    await renderPanel({ root, wasm, descriptor: panel, context, invoker: { invoke }, admission: "unrestricted" });
    const select = root.querySelector("select")!;
    expect(select.dataset.valueTone).toBe(labeled ? "success" : undefined);
    expect(select.selectedOptions[0].textContent).toBe(labeled ? "Western region" : "west");
    expect(Array.from(select.options, option => option.dataset.valueTone)).toEqual(labeled ? ["success", "danger", undefined] : [undefined, undefined, undefined]);
    select.value = "east"; select.dispatchEvent(new Event("change"));
    expect(select.dataset.valueTone).toBe(labeled ? "danger" : undefined);
    expect(select.selectedOptions[0].textContent).toBe("east");
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true })); await flush();
    expect(invoke).toHaveBeenLastCalledWith("demo.Form", "Save", { resource: "record", region: "east" });
    select.value = "other"; select.dispatchEvent(new Event("change"));
    expect(select.hasAttribute("data-value-tone")).toBe(false);
    disposePanel(root);
  }
});
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
