// @vitest-environment jsdom
import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { StepsPanelSchema } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { InvocationHost, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { afterEach, expect, it, vi } from "vitest";
import { disposePanel, renderPanel, type RenderPanelOptions } from "../src/uiview/renderer.js";
import { disposeView, renderView } from "../src/uiview/view_renderer.js";
import { webComponentsRenderer } from "../src/uiview/web_components_renderer.js";

const wasm = { renderTable: () => [], buildPopulateRequest: () => ({}), readPath: () => null,
  buildRequest: () => { throw Error("Do not use the legacy host builder for user actions"); }, renderTablePanel: () => [], formatLroMetadata: () => "" };
afterEach(() => { for (const root of document.body.querySelectorAll<HTMLElement>("[data-test-root]")) { disposePanel(root); disposeView(root); } document.body.replaceChildren(); });
function setup(intent: JsonObject = { copy: "literal" }) {
  const root = document.createElement("div"); root.dataset.testRoot = ""; document.body.append(root);
  const cap = () => vi.fn(async (_value: unknown, _context: unknown, _signal: AbortSignal) => {});
  const caps = { uri: cap(), command: cap(), navigate: cap(), openPanel: cap(), openView: cap(), copy: cap() };
  const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({}));
  const context = { currentResourcePath: "raw/current", uiIdentity: null, selectedRow: { id: 0, active: false }, formValues: { raw: "e\u0301" }, selections: { tenant: false } };
  const admit = vi.fn(() => true);
  const invocation: InvocationHost = { capabilities: caps, context, admit };
  const descriptor = create(PanelDescriptorSchema, { panelId: "action", body: { case: "action", value: { action: fromJson(AffordanceSchema, { label: "Canonical", ...intent }) } } });
  const opts: RenderPanelOptions = { root, wasm, context, descriptor, invoker: { invoke }, invocation, admission: { mutations: ["raw.Service/Get"] } };
  const button = () => root.querySelector<HTMLButtonElement>("button.mer-affordance")!;
  return { root, opts, caps, invoke, context, admit, descriptor, button, draw: () => renderPanel(opts) };
}

it.each<JsonObject>([{ uri: "/safe" }, { command: "literal shell" }, { navigate: { route: "/safe" } }, { openPanel: { panelId: "inline" } }, { openView: "view" }, { copy: "literal" }])("admits actual panel %j without implicit href/copy", async intent => {
  const host = setup(intent); await host.draw(); host.button().focus();
  expect(host.admit).not.toHaveBeenCalled(); expect(host.root.querySelector("a[href]")).toBeNull();
  for (const effect of Object.values(host.caps)) expect(effect).not.toHaveBeenCalled();
  host.button().click(); const kind = Object.keys(intent)[0] as keyof typeof host.caps;
  await vi.waitFor(() => expect(host.caps[kind]).toHaveBeenCalledTimes(1));
  expect(host.caps[kind]).toHaveBeenCalledWith(expect.anything(), host.context, expect.any(AbortSignal));
  await vi.waitFor(() => expect(host.root.textContent).toContain("Action completed."));
  expect(host.invoke).not.toHaveBeenCalled();
});

it("uses actual Rust bindings with mutation-only admission and no read-tier requirement", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get", bindings: [
    { requestField: "id", rowField: "id" }, { requestField: "raw", formField: "raw" }, { requestField: "tenant", selectionKey: "tenant" },
  ] } }); await host.draw(); host.button().click();
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledWith("raw.Service", "Get", { id: 0, raw: "e\u0301", tenant: false }));
  expect(host.invoke).toHaveBeenCalledTimes(1);
});

it.each(["empty", "capability", "policy", "mutation", "unsafe"])("denies %s visibly, with no effect or clipboard fallback", async reason => {
  const host = setup(reason === "empty" ? {} : reason === "mutation" ? { rpc: { service: "raw.Service", method: "Get" } }
    : reason === "unsafe" ? { uri: "javascript:alert(1)" } : undefined);
  if (reason === "capability") host.opts.invocation = { ...host.opts.invocation, capabilities: {} };
  if (reason === "policy") host.admit.mockReturnValue(false);
  if (reason === "mutation") host.opts.admission = { reads: ["raw.Service/Get"] };
  await host.draw(); host.button().click();
  await vi.waitFor(() => expect(host.root.querySelector('[role="alert"]')?.textContent).toMatch(/Action (denied|unavailable)/));
  expect(host.invoke).not.toHaveBeenCalled(); for (const effect of Object.values(host.caps)) expect(effect).not.toHaveBeenCalled();
});

it("retains duplicate suppression through canceled noncooperative settlement and returns focus", async () => {
  const host = setup(); let settle!: () => void;
  host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; })); await host.draw(); host.button().click();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  const cancel = host.root.querySelector<HTMLButtonElement>("button:not(.mer-affordance)")!; cancel.focus(); cancel.click();
  expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true); host.button().click(); expect(host.caps.copy).toHaveBeenCalledTimes(1);
  expect(cancel.hidden).toBe(false); settle();
  await vi.waitFor(() => expect(cancel.hidden).toBe(true)); expect(document.activeElement).toBe(host.button());
});

it.each(["dispose", "replace", "context"])("suppresses late %s completion and refresh", async change => {
  const host = setup({ copy: "literal", refreshOnSuccess: true }); let settle!: () => void;
  const refresh = vi.fn(async () => {}); host.opts.invocation = { ...host.opts.invocation, refresh };
  host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; })); await host.draw(); host.button().click();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  if (change === "dispose") disposePanel(host.root);
  if (change === "replace") await host.draw();
  if (change === "context") host.context.currentResourcePath = "changed";
  if (change !== "context") expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true);
  settle(); await vi.waitFor(() => expect(host.caps.copy.mock.results[0]!.type).toBe("return"));
  await new Promise(resolve => setTimeout(resolve, 0)); expect(refresh).not.toHaveBeenCalled(); expect(host.root.textContent).not.toContain("Action completed.");
});

it("sanitizes effect and refresh failures without replay", async () => {
  const host = setup({ copy: "literal", refreshOnSuccess: true }); const refresh = vi.fn(async () => { throw Error("private refresh"); });
  host.opts.invocation = { ...host.opts.invocation, refresh }; host.caps.copy.mockRejectedValueOnce(Error("private payload")); await host.draw(); host.button().click();
  await vi.waitFor(() => expect(host.root.textContent).toContain("Action failed.")); expect(host.root.textContent).not.toContain("private payload");
  host.button().click(); await vi.waitFor(() => expect(host.root.textContent).toContain("without repeating the action"));
  expect(host.caps.copy).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(1); expect(host.button().dataset.error).toBeUndefined();
});

it("forwards capabilities through the public mount and disposes pending work on unmount", async () => {
  const host = setup(); let settle!: () => void; host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  const handle = await webComponentsRenderer(wasm).mount({ ...host.opts, container: host.root }); host.button().click();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1)); handle.unmount();
  expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true); settle(); expect(host.root.textContent).toBe("");
});

it.each(["header", "slot"])("normalizes %s canonical presence whole, including explicit empty", async position => {
  const host = setup(); const source = { actions: [{ id: "legacy", label: "Legacy", call: { service: "raw.Service", method: "Get" } }],
    affordances: { items: [fromJson(AffordanceSchema, { label: "Canonical", copy: "literal" })] } };
  const view = create(ViewDescriptorSchema, position === "header" ? source : { slots: [{ id: "slot", ...source }] });
  await renderView({ ...host.opts, view }); expect(host.root.textContent).not.toContain("Legacy"); host.button().click();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  if (position === "header") view.affordances!.items = []; else view.slots[0]!.affordances!.items = [];
  await renderView({ ...host.opts, view }); expect(host.root.querySelector("button.mer-affordance")).toBeNull(); expect(host.invoke).not.toHaveBeenCalled();
});

it("rechecks current raw row/subject after semantic confirmation and disposes headers", async () => {
  const host = setup(); let consent!: (value: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>(resolve => { consent = resolve; }));
  const resolveSemantic = vi.fn(() => ({ affordance: fromJson(AffordanceSchema, { copy: "resolved" }), confirm }));
  const view = create(ViewDescriptorSchema, { subjectKind: "Rows", subjectId: "raw/id", actions: [{ id: "open", label: "Open" }] });
  await renderView({ ...host.opts, invocation: { ...host.opts.invocation, resolveSemantic }, view }); host.button().click();
  expect(resolveSemantic).toHaveBeenCalledWith(expect.objectContaining({ id: "open" }), host.context, { entityType: "Rows", entityId: "raw/id" });
  host.context.selectedRow.id = 2; consent(true); await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.caps.copy).not.toHaveBeenCalled(); host.button().click(); disposeView(host.root); consent(true);
  await new Promise(resolve => setTimeout(resolve, 0)); expect(host.caps.copy).not.toHaveBeenCalled();
});

it.each(["bytes", "cycle", "getter"])("rejects invalid %s context without effects or getter execution", async kind => {
  const host = setup(); const getter = vi.fn(() => "secret");
  if (kind === "bytes") host.context.formValues.raw = "x".repeat(800_000);
  if (kind === "cycle") (host.context.formValues as object as { self: unknown }).self = host.context.formValues;
  if (kind === "getter") Object.defineProperty(host.context, "selectedRow", { enumerable: true, get: getter });
  await host.draw(); host.button().click(); expect(host.root.querySelector('[role="alert"]')).not.toBeNull();
  expect(getter).not.toHaveBeenCalled(); expect(host.admit).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled();
});

it("preserves canonical description/icon/tone/emphasis with linked sanitized feedback", async () => {
  const host = setup({ copy: "literal", description: "Canonical description", icon: "copy-key", tone: "TONE_DANGER", emphasis: "EMPHASIS_PRIMARY" });
  const glyph = document.createElement("i"); host.opts.renderIcon = vi.fn(() => glyph); await host.draw();
  expect(host.button().dataset.icon).toBe("copy-key"); expect(host.button().contains(glyph)).toBe(true);
  expect(host.button().dataset.merTone).toBe("danger"); expect(host.button().dataset.merEmphasis).toBe("primary");
  expect(document.getElementById(host.button().getAttribute("aria-describedby")!)?.textContent).toBe("Canonical description");
});

it("uses the same admission for nested step commands instead of copying their text", async () => {
  const host = setup(); host.descriptor.body = { case: "steps", value: create(StepsPanelSchema, {
    steps: [{ label: "Step", action: fromJson(AffordanceSchema, { label: "Nested", command: "literal command" }) }],
  }) };
  await host.draw(); host.button().click(); await vi.waitFor(() => expect(host.caps.command).toHaveBeenCalledTimes(1));
  expect(host.caps.copy).not.toHaveBeenCalled();
});

it("rejects unsafe semantically resolved destinations despite permissive host policy", async () => {
  const host = setup(); const resolveSemantic = vi.fn(() => ({ affordance: fromJson(AffordanceSchema, { uri: "javascript:alert(1)" }) }));
  await renderView({ ...host.opts, invocation: { ...host.opts.invocation, resolveSemantic },
    view: create(ViewDescriptorSchema, { actions: [{ id: "open", label: "Open" }] }) });
  host.button().click(); await vi.waitFor(() => expect(host.root.textContent).toContain("Action denied")); expect(host.caps.uri).not.toHaveBeenCalled();
});

it("withdraws inactive-tab controls and cancels their pending capability", async () => {
  const host = setup(); let settle!: () => void; host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  await renderView({ ...host.opts, view: create(ViewDescriptorSchema, { layout: { mode: { case: "tabbed", value: {} } }, slots: [
    { id: "first", placement: { tabLabel: "First" }, affordances: { items: [fromJson(AffordanceSchema, { label: "First action", copy: "literal" })] } },
    { id: "second", placement: { tabLabel: "Second" } },
  ] }) }); host.button().click(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  host.root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
  expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true); settle();
  await new Promise(resolve => setTimeout(resolve, 0)); expect(host.root.textContent).not.toContain("Action completed.");
});

it("counts header and slot controls in the unchanged shared composition ceiling", async () => {
  const host = setup(); const action = fromJson(AffordanceSchema, { label: "Bounded", copy: "literal" });
  await renderView({ ...host.opts, view: create(ViewDescriptorSchema, { affordances: { items: Array.from({ length: 500 }, () => action) },
    slots: [{ id: "slot", affordances: { items: Array.from({ length: 500 }, () => action) } }],
  }) });
  expect(host.root.querySelector('[role="alert"]')?.textContent).toContain("View composition limit exceeded");
  expect(host.button()).toBeNull(); expect(host.admit).not.toHaveBeenCalled();
});
