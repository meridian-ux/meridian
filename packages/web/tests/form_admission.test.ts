// @vitest-environment jsdom
import { create, fromJson, toJson, type JsonObject } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { readFrozen } from "../../../schemas/tests/frozen_affordance.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { afterEach, expect, it, vi } from "vitest";
import { disposePanel, renderPanel, type RenderPanelOptions } from "../src/uiview/renderer.js";

afterEach(() => { for (const root of document.querySelectorAll<HTMLElement>("[data-form-test]")) disposePanel(root); document.body.replaceChildren(); });
const wasm = { renderTable: () => [], renderTablePanel: () => [], readPath: () => null, buildPopulateRequest: () => ({}), formatLroMetadata: () => "",
  buildRequest: () => ({}), buildSubmissionRequest: () => { throw Error("Do not use legacy host submission builder"); } };
function setup(intent: JsonObject = { copy: "canonical" }) {
  const root = document.createElement("div"); root.dataset.formTest = ""; document.body.append(root);
  const descriptor = create(PanelDescriptorSchema, { body: { case: "form", value: { mode: 2, itemNoun: "legacy",
    submitAffordance: fromJson(AffordanceSchema, { label: "Canonical submit", ...intent }), fields: [
      { fieldId: "name", label: "Name", requestField: "legacy.name", kind: { case: "text", value: { defaultValue: "initial", minLength: 2 } } },
      { fieldId: "zero", label: "Zero", kind: { case: "integer", value: { defaultValue: 0 } } },
      { fieldId: "flag", label: "Flag", kind: { case: "boolean", value: { defaultValue: false } } },
    ],
  } } });
  if (descriptor.body.case !== "form") throw Error("form");
  const form = descriptor.body.value;
  Object.assign(form, readFrozen(FormPanelSchema, { ...toJson(FormPanelSchema, form), submit: { service: "legacy.Forms", method: "Delete" } }));
  const cap = () => vi.fn(async (_target: unknown, _context: unknown, _signal: AbortSignal) => {});
  const caps = { uri: cap(), command: cap(), navigate: cap(), openPanel: cap(), openView: cap(), copy: cap() };
  const invoke = vi.fn(async (_service: string, _method: string, _request: object) => ({}));
  const context = { currentResourcePath: "current/raw", uiIdentity: null, selectedRow: { id: 0 }, formValues: { hidden: "must not collect" }, selections: { tenant: false } };
  const admit = vi.fn(() => true);
  const opts: RenderPanelOptions = { root, wasm, descriptor, context, invoker: { invoke }, admission: { mutations: ["raw.Forms/Get", "legacy.Forms/Delete"] }, invocation: { context, capabilities: caps, admit } };
  const input = () => root.querySelector<HTMLInputElement>('[name="name"]')!;
  const submit = () => root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return { root, opts, descriptor, form, caps, invoke, context, admit, input, submit, draw: () => renderPanel(opts),
    button: () => root.querySelector<HTMLButtonElement>('button[type="submit"]')!,
  };
}

it.each<JsonObject>([{ uri: "/safe" }, { command: "literal" }, { navigate: { route: "/safe" } }, { openPanel: { panelId: "inline" } }, { openView: "view" }, { copy: "literal" }])("admits actual form %j with exact collected values and no legacy save", async intent => {
  const host = setup(intent); await host.draw(); host.input().value = "raw/e\u0301"; host.button().focus();
  expect(host.admit).not.toHaveBeenCalled(); host.submit(); const key = Object.keys(intent)[0] as keyof typeof host.caps;
  await vi.waitFor(() => expect(host.caps[key]).toHaveBeenCalledTimes(1));
  expect(host.caps[key]).toHaveBeenCalledWith(expect.anything(), { ...host.context, formValues: { name: "raw/e\u0301", zero: 0, flag: false } }, expect.any(AbortSignal));
  expect(host.invoke).not.toHaveBeenCalled(); expect(host.input().value).toBe("raw/e\u0301");
});

it("uses actual Rust automatic Form mapping and explicit binding precedence", async () => {
  const host = setup({ rpc: { service: "raw.Forms", method: "Get", bindings: [
    { requestField: "copied", formField: "name" }, { requestField: "name", literal: "bound" }, { requestField: "row", rowField: "id" }, { requestField: "scope", selectionKey: "tenant" },
  ] } }); await host.draw(); host.input().value = "raw/e\u0301"; host.submit();
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledWith("raw.Forms", "Get", { copied: "raw/e\u0301", name: "bound", row: 0, scope: false, zero: 0, flag: false }));
  expect(host.invoke).toHaveBeenCalledTimes(1);
});

it.each(["empty", "capability", "policy", "mutation"])("canonical %s never revives legacy submit", async reason => {
  const host = setup(reason === "empty" ? {} : reason === "mutation" ? { rpc: { service: "raw.Forms", method: "Get" } } : undefined);
  if (reason === "capability") host.opts.invocation = { ...host.opts.invocation, capabilities: {} };
  if (reason === "policy") host.admit.mockReturnValue(false);
  if (reason === "mutation") host.opts.admission = { reads: ["raw.Forms/Get"], mutations: ["legacy.Forms/Delete"] };
  await host.draw(); host.submit();
  await vi.waitFor(() => expect(host.root.textContent).toMatch(/Action (denied|unavailable)/));
  expect(host.invoke).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled();
});

it("collects no DOM inputs during paint/focus and never imports the ambient form bag", async () => {
  const host = setup(); const ambient = vi.fn(() => { throw Error("must not read host form bag"); });
  Object.defineProperty(host.context, "formValues", { enumerable: true, get: ambient }); await host.draw();
  const read = vi.fn(() => "collected"); Object.defineProperty(host.input(), "value", { configurable: true, get: read });
  host.input().focus(); host.button().focus(); expect(read).not.toHaveBeenCalled(); expect(ambient).not.toHaveBeenCalled();
  host.submit(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  expect(read).toHaveBeenCalled(); expect(ambient).not.toHaveBeenCalled();
});

it("validates before host policy, capability or transport", async () => {
  const host = setup(); await host.draw(); host.input().value = ""; host.submit();
  expect(host.root.textContent).toContain("invalid length"); expect(host.admit).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
});

it("keeps failed input, sanitizes host errors, and retries current values", async () => {
  const host = setup(); host.caps.copy.mockRejectedValueOnce(Error("private host error")); await host.draw(); host.input().value = "keep this"; host.submit();
  await vi.waitFor(() => expect(host.root.textContent).toContain("Action failed.")); expect(host.root.textContent).not.toContain("private host");
  expect(host.input().value).toBe("keep this"); host.input().value = "retry current"; host.submit();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(2));
  expect((host.caps.copy.mock.calls[1]![1] as { formValues: object }).formValues).toEqual({ name: "retry current", zero: 0, flag: false });
});

it("disables fields but retains reachable cancellation and the duplicate guard to settlement", async () => {
  const host = setup(); let settle!: () => void; host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  await host.draw(); host.button().focus(); host.submit(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  expect(host.root.querySelector("fieldset")!.disabled).toBe(true); expect(host.button().disabled).toBe(false);
  const cancel = Array.from(host.root.querySelectorAll("button")).find(button => button.textContent === "Cancel action")!; cancel.focus(); cancel.click();
  expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true); host.submit(); expect(host.caps.copy).toHaveBeenCalledTimes(1);
  settle(); await vi.waitFor(() => expect(cancel.hidden).toBe(true)); expect(document.activeElement).toBe(host.button()); expect(host.root.querySelector("fieldset")!.disabled).toBe(false);
});

it.each(["dispose", "replace", "context", "input"])("suppresses obsolete %s completion and refresh", async change => {
  const host = setup({ copy: "literal", refreshOnSuccess: true }); let settle!: () => void; const refresh = vi.fn(async () => {});
  host.opts.invocation = { ...host.opts.invocation, refresh }; host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  await host.draw(); host.submit(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  if (change === "dispose") disposePanel(host.root); if (change === "replace") await host.draw();
  if (change === "context") host.context.currentResourcePath = "changed"; if (change === "input") host.input().value = "changed";
  if (change === "dispose" || change === "replace") expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true);
  settle(); await new Promise(resolve => setTimeout(resolve, 0)); expect(refresh).not.toHaveBeenCalled(); expect(host.root.textContent).not.toContain("Action completed.");
});

it("waits for prefill, projects only own declared values, and preserves loaded edits after success", async () => {
  const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" }); let finish!: (value: object) => void;
  host.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await host.draw();
  expect(host.button()).toBeNull(); expect(host.root.querySelector("fieldset")!.disabled).toBe(true); host.submit(); expect(host.caps.copy).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(1)); finish({ name: "loaded", zero: 0, flag: false, hidden: "never collect", constructor: "never collect" });
  await vi.waitFor(() => expect(host.button()).not.toBeNull()); expect(host.input().value).toBe("loaded"); host.submit();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1)); expect(host.input().value).toBe("loaded");
  expect((host.caps.copy.mock.calls[0]![1] as { formValues: object }).formValues).toEqual({ name: "loaded", zero: 0, flag: false });
});

it.each(["error", "getter", "rows"])("keeps defaults with a generic warning after invalid %s prefill", async kind => {
  const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" }); const getter = vi.fn(() => "private getter");
  if (kind === "rows") host.form.fields.push(create(FormFieldSchema, { fieldId: "rows", label: "Rows", kind: { case: "repeated", value: { element: { case: "scalar", value: { kind: { case: "text", value: {} } } } } } }));
  host.invoke.mockImplementation(async () => {
    if (kind === "error") throw Error("private prefill error");
    return kind === "getter" ? Object.defineProperty({}, "name", { enumerable: true, get: getter }) : { rows: Array.from({ length: 1001 }, () => "row") };
  }); await host.draw(); await vi.waitFor(() => expect(host.button()).not.toBeNull());
  expect(host.input().value).toBe("initial"); expect(host.root.textContent).toContain("Initial values unavailable; showing descriptor defaults.");
  expect(host.root.textContent).not.toContain("private"); expect(getter).not.toHaveBeenCalled(); expect(host.root.querySelectorAll("input").length).toBeLessThan(10);
});

it("never submits a read-only form even with canonical intent and a forged submit event", async () => {
  const host = setup(); host.form.mode = 1; host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" }); await host.draw(); host.submit();
  expect(host.button()).toBeNull(); expect(host.invoke).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled();
});

it("retains refresh failure as a distinct success without replay or clearing input", async () => {
  const host = setup({ copy: "literal", refreshOnSuccess: true }); const refresh = vi.fn(async () => { throw Error("private refresh"); }); host.opts.invocation = { ...host.opts.invocation, refresh };
  await host.draw(); host.input().value = "keep input"; host.submit(); await vi.waitFor(() => expect(host.root.textContent).toContain("without repeating the action"));
  expect(host.input().value).toBe("keep input"); expect(host.caps.copy).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledTimes(1);
});

it("suppresses late prefill from a replaced form", async () => {
  const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" }); let finish!: (value: object) => void;
  host.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await host.draw();
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(1)); host.form.prefill = undefined; await host.draw();
  finish({ name: "obsolete" }); await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.input().value).toBe("initial"); host.submit(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
});

it("projects declared repeated-object children before retaining prefill", async () => {
  const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
  host.form.fields.push(create(FormFieldSchema, { fieldId: "entries", label: "Entries", kind: { case: "repeated", value: {
    element: { case: "object", value: { fields: [{ fieldId: "known", label: "Known", kind: { case: "text", value: {} } }] } },
  } } }));
  host.invoke.mockResolvedValueOnce({ entries: [{ known: "kept", hidden: "never collect" }] }); await host.draw(); await vi.waitFor(() => expect(host.button()).not.toBeNull()); host.submit();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  expect((host.caps.copy.mock.calls[0]![1] as { formValues: object }).formValues).toEqual({ name: "initial", zero: 0, flag: false, entries: [{ known: "kept" }] });
});

it("preserves empty canonical labels without reviving the legacy label", async () => {
  const host = setup({ label: "", copy: "literal" }); await host.draw(); expect(host.button().textContent).toBe("Action");
  expect(host.root.textContent).not.toContain("Save legacy"); host.submit(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1)); expect(host.invoke).not.toHaveBeenCalled();
});

it("retains input on shared Rust work-budget rejection and succeeds on smaller retry", async () => {
  const host = setup({ rpc: { service: "raw.Forms", method: "Get", bindings: Array.from({ length: 10 }, () => ({ requestField: "scope", rowField: "payload" })) } });
  host.opts.invocation = { ...host.opts.invocation, context: { ...host.context, selectedRow: { payload: "s".repeat(400_000) } } };
  await host.draw(); host.input().value = "v".repeat(200_000); host.submit();
  await vi.waitFor(() => expect(host.root.textContent).toContain("Action failed.")); expect(host.invoke).not.toHaveBeenCalled(); expect(host.input().value).toHaveLength(200_000);
  expect(host.admit).toHaveBeenCalledTimes(1); // Reached actual Rust after snapshot and target admission.
  host.input().value = "smaller retry"; host.submit(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(1));
  const request = host.invoke.mock.calls[0]![2] as { scope: string; name: string };
  expect(request.scope).toHaveLength(400_000); expect(request.name).toBe("smaller retry");
});

it("loads authoritative remote choices before enabling submit and rejects forged static options", async () => {
  const host = setup(); let finish!: (value: object) => void;
  host.form.fields.push(create(FormFieldSchema, { fieldId: "region", label: "Region", kind: { case: "enumSelection", value: {
    defaultValue: "static", allowedValues: ["static"], optionsSource: { service: "read.Options", method: "List", optionsField: "items", valueField: "id", labelField: "label" },
  } } })); host.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await host.draw(); expect(host.button()).toBeNull(); expect(host.root.querySelector("fieldset")!.disabled).toBe(true); host.submit(); expect(host.caps.copy).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledWith("read.Options", "List", {})); finish({ items: [{ id: "remote", label: "Remote choice" }] });
  await vi.waitFor(() => expect(host.button()).not.toBeNull()); const select = host.root.querySelector("select")!;
  expect(Array.from(select.options).map(option => option.value)).toEqual(["remote"]);
  const forged = document.createElement("option"); forged.value = "static"; select.append(forged); select.value = "static"; host.submit();
  expect(host.admit).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled(); select.value = "remote"; host.submit();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  expect((host.caps.copy.mock.calls[0]![1] as { formValues: { region: string } }).formValues.region).toBe("remote");
});

it.each(["read-denied", "failure", "aggregate"])("keeps remote choices closed on %s with safe retry", async reason => {
  const host = setup();
  host.form.fields.push(...["one", "two"].map(fieldId => create(FormFieldSchema, { fieldId, label: fieldId, kind: { case: "enumSelection", value: {
    allowedValues: ["static"], optionsSource: { service: "read.Options", method: "List", optionsField: "items", valueField: "id" },
  } } })));
  if (reason === "read-denied") host.opts.admission = { reads: [], mutations: ["raw.Forms/Get"] };
  host.invoke.mockImplementation(async () => {
    if (reason === "failure") throw Error("private options error");
    return { items: Array.from({ length: reason === "aggregate" ? 600 : 1 }, (_, index) => ({ id: String(index) })) };
  }); await host.draw(); await vi.waitFor(() => expect(host.root.textContent).toContain("Options unavailable"));
  expect(host.button()).toBeNull(); expect(host.root.textContent).not.toContain("private options"); expect(host.root.querySelector("select")).toBeNull(); host.submit(); expect(host.caps.copy).not.toHaveBeenCalled();
  if (reason === "read-denied") expect(host.invoke).not.toHaveBeenCalled();
  else {
    host.invoke.mockImplementation(async () => ({ items: [{ id: "current" }] }));
    Array.from(host.root.querySelectorAll("button")).find(button => button.textContent === "Retry options")!.click();
    await vi.waitFor(() => expect(host.button()).not.toBeNull());
    for (const select of host.root.querySelectorAll("select")) select.value = "current";
    host.submit(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  }
});

it("bounds omitted nested defaults multiplied by prefilled repeated objects before DOM expansion", async () => {
  const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
  host.form.fields.push(create(FormFieldSchema, { fieldId: "outer", kind: { case: "repeated", value: { element: { case: "object", value: { fields: [
    { fieldId: "inner", kind: { case: "repeated", value: { minItems: 600, element: { case: "scalar", value: { kind: { case: "text", value: {} } } } } } },
  ] } } } } }));
  host.invoke.mockResolvedValueOnce({ outer: [{}, {}] }); await host.draw(); await vi.waitFor(() => expect(host.button()).not.toBeNull());
  expect(host.root.textContent).toContain("Initial values unavailable"); expect(host.root.querySelectorAll("input").length).toBeLessThan(10);
  expect(host.caps.copy).not.toHaveBeenCalled();
});
