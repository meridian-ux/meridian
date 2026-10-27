// @vitest-environment jsdom
import { create, fromBinary } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { afterEach, expect, it, vi } from "vitest";
import { disposePanel, renderPanel, type RenderPanelOptions } from "../src/uiview/renderer.js";

afterEach(() => { for (const root of document.querySelectorAll<HTMLElement>("[data-resource-test]")) disposePanel(root); document.body.replaceChildren(); });
function setup(confirmation = true) {
  const root = document.createElement("div"); root.dataset.resourceTest = ""; document.body.append(root);
  const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
    populate: { service: "Rows", method: "List" }, rowsField: "items", template: { titleField: "name", actions: { actions: [{
      id: "get", label: "Use resource", style: 3, visibleWhen: "phase==false", invoke: { service: "Rows", method: "Get", bindings: [
        { requestField: "id", source: { case: "rowField", value: "id" } }, { requestField: "name", source: { case: "rowField", value: "name" } },
        { requestField: "flag", source: { case: "rowField", value: "phase" } }, { requestField: "scope", source: { case: "selectionKey", value: "scope" } },
      ] }, confirm: confirmation ? { title: "Use resource?", message: "Literal <b>message</b>", confirmLabel: "Accept resource", destructive: true } : undefined,
    }] } },
  } } });
  if (descriptor.body.case !== "resourceCards") throw Error("resource"); const panel = descriptor.body.value, action = panel.template!.actions!.actions[0];
  const row = { id: 0, name: "raw/e\u0301", phase: false };
  const buildRequest = vi.fn((bytes: Uint8Array) => { if (fromBinary(RpcCallSchema, bytes).method !== "List") throw Error("Obsolete user request builder"); return {}; });
  const wasm = { renderTable: () => [], renderTablePanel: () => [], buildPopulateRequest: () => ({}), readPath: () => null, buildRequest, formatLroMetadata: () => "" };
  const invoke = vi.fn(async (_service: string, method: string, _request: object) => method === "List" ? { items: [row] } : {});
  const context = { currentResourcePath: "current/raw", uiIdentity: null, selectedRow: { id: "ambient" }, formValues: {}, selections: { scope: false } };
  const admit = vi.fn(() => true), refresh = vi.fn(async () => {});
  const admission = { reads: ["Rows/List"], mutations: ["Rows/Get"] };
  const opts: RenderPanelOptions = { root, descriptor, wasm, context, invoker: { invoke }, admission, invocation: { context, admit, refresh } };
  const button = () => root.querySelector<HTMLButtonElement>(".mer-resource-action")!;
  const confirm = () => root.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click();
  return { root, descriptor, panel, action, row, opts, admission, invoke, context, admit, refresh, buildRequest, button, confirm, draw: () => renderPanel(opts) };
}

it.each([false, true])("uses actual Rust for resource RPC, confirmation=%s", async confirmation => {
  const host = setup(confirmation); await host.draw(); host.button().focus(); expect(host.admit).not.toHaveBeenCalled(); host.button().click();
  if (confirmation) { expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.root.querySelector('[role="alertdialog"]')!.getAttribute("aria-labelledby")).toBeTruthy(); expect(host.root.querySelector('[role="alertdialog"] b')).toBeNull(); host.confirm(); }
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledWith("Rows", "Get", { id: 0, name: "raw/e\u0301", flag: false, scope: false }));
  expect(host.invoke).toHaveBeenCalledTimes(2); expect(host.buildRequest).toHaveBeenCalledTimes(1); expect(host.refresh).not.toHaveBeenCalled(); expect(host.button().classList.contains("mer-resource-action-danger")).toBe(true);
});

it.each(["mutation", "target", "missing intent"])("%s denial cannot open confirmation or invoke", async reason => {
  const host = setup(); if (reason === "mutation") host.opts.admission = { reads: ["Rows/List", "Rows/Get"] }; if (reason === "target") host.admit.mockReturnValue(false); if (reason === "missing intent") host.action.invoke = undefined;
  await host.draw(); host.button().click(); await vi.waitFor(() => expect(host.root.textContent).toMatch(/Action (denied|unavailable)/)); expect(host.root.querySelector('[role="alertdialog"]')).toBeNull(); expect(host.invoke).toHaveBeenCalledTimes(1);
});

it.each(["cancel", "Escape"])("%s declines consent, restores focus and permits a fresh attempt", async mode => {
  const host = setup(); await host.draw(); host.button().focus(); host.button().click(); const prompt = host.root.querySelector('[role="alertdialog"]')!;
  const cancel = prompt.querySelectorAll<HTMLButtonElement>("button")[1]; expect(document.activeElement).toBe(cancel);
  if (mode === "cancel") cancel.click(); else cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false)); expect(host.root.querySelector('[role="alertdialog"]')).toBeNull(); expect(document.activeElement).toBe(host.button()); expect(host.invoke).toHaveBeenCalledTimes(1);
  host.button().click(); host.confirm(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(2));
});

it("cycles focus within confirmation and uses literal authored title/message", async () => {
  const host = setup(); await host.draw(); host.button().click(); const prompt = host.root.querySelector('[role="alertdialog"]')!, [accept, cancel] = [...prompt.querySelectorAll<HTMLButtonElement>("button")];
  expect(prompt.textContent).toContain("Literal <b>message</b>"); expect(prompt.querySelector("b")).toBeNull();
  cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); expect(document.activeElement).toBe(accept);
  accept.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); expect(document.activeElement).toBe(cancel);
});

it.each(["row", "context", "predicate", "policy", "target", "confirmation"])("invalidates changed %s consent before effect", async change => {
  const host = setup(); await host.draw(); host.button().click();
  if (change === "row") host.row.name = "changed"; if (change === "context") host.context.currentResourcePath = "new"; if (change === "predicate") host.row.phase = true;
  if (change === "policy") host.admission.mutations.length = 0;
  if (change === "target") host.action.invoke!.method = "Delete"; if (change === "confirmation") host.action.confirm!.message = "Changed consent";
  host.confirm(); await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false)); expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.refresh).not.toHaveBeenCalled(); expect(host.root.textContent).not.toContain("Action completed.");
});

it.each(["dispose", "replace", "cancel action"])("withdraws %s confirmation and cannot execute a retained accept button", async change => {
  const host = setup(); await host.draw(); host.button().click(); const accept = host.root.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!;
  if (change === "dispose") disposePanel(host.root); if (change === "replace") await host.draw();
  if (change === "cancel action") [...host.root.querySelectorAll("button")].find(button => button.textContent === "Cancel action" && !button.hidden)!.click();
  expect(host.root.querySelector('[role="alertdialog"]')).toBeNull(); accept.click(); await new Promise(resolve => setTimeout(resolve, 0)); expect(host.invoke).toHaveBeenCalledTimes(change === "replace" ? 2 : 1);
});

it("shares the per-card pending guard through confirmation and noncooperative RPC cancellation", async () => {
  const host = setup(); host.panel.template!.actions!.actions.push({ ...host.action, id: "other", label: "Other resource action" }); let settle!: (value: object) => void;
  await host.draw(); host.invoke.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; })); host.button().click(); host.button().click(); expect(host.root.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  const other = host.root.querySelectorAll<HTMLButtonElement>(".mer-resource-action")[1]; expect(other.disabled).toBe(true); other.click(); expect(host.admit).toHaveBeenCalledTimes(1); host.confirm(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(2));
  const cancel = [...host.root.querySelectorAll("button")].find(button => button.textContent === "Cancel action" && !button.hidden)!; cancel.focus(); cancel.click(); host.button().click(); other.click(); expect(host.invoke).toHaveBeenCalledTimes(2);
  settle({}); await vi.waitFor(() => expect(cancel.hidden).toBe(true)); expect(document.activeElement).toBe(host.button()); expect(other.disabled).toBe(false); expect(host.root.textContent).not.toContain("Action completed.");
});

it("sanitizes failure, retains the card and re-confirms a current-row retry", async () => {
  const host = setup(); await host.draw(); host.invoke.mockRejectedValueOnce(Error("private resource failure")); host.button().click(); host.confirm(); await vi.waitFor(() => expect(host.root.textContent).toContain("Action failed."));
  expect(host.root.textContent).not.toContain("private resource failure"); const card = host.root.querySelector("article"); host.row.name = "retry/raw"; host.button().click(); host.confirm();
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(3)); expect(host.invoke.mock.calls[2][2]).toEqual({ id: 0, name: "retry/raw", flag: false, scope: false }); expect(host.root.querySelector("article")).toBe(card);
});

it("does not synthesize an id for an unbound resource call", async () => {
  const host = setup(false); host.action.invoke!.bindings = []; await host.draw(); host.button().click(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(2)); expect(host.invoke.mock.calls[1][2]).toEqual({});
});

it.each(["row", "context", "dispose", "replace"])("suppresses obsolete %s RPC completion", async change => {
  const host = setup(false); await host.draw(); let finish!: (value: object) => void; host.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  host.button().click(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(2));
  if (change === "row") host.row.name = "replacement"; if (change === "context") host.context.currentResourcePath = "replacement";
  if (change === "dispose") disposePanel(host.root); if (change === "replace") await host.draw();
  finish({}); await new Promise(resolve => setTimeout(resolve, 0)); expect(host.root.textContent).not.toContain("Action completed."); expect(host.refresh).not.toHaveBeenCalled(); expect(host.invoke).toHaveBeenCalledTimes(change === "replace" ? 3 : 2);
});

it("ignores an old populate after the panel is replaced", async () => {
  const host = setup(); let finish!: (value: object) => void; host.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const oldDraw = host.draw(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(1)); await host.draw(); const card = host.root.querySelector("article"); finish({ items: [{ ...host.row, name: "obsolete row" }] }); await oldDraw;
  expect(host.root.querySelectorAll("article")).toHaveLength(1); expect(host.root.querySelector("article")).toBe(card); expect(host.root.textContent).not.toContain("obsolete row");
});

it("keeps resource visibility predicates and style without invoking during paint", async () => {
  const host = setup(); host.row.phase = true; await host.draw(); expect(host.button()).toBeNull(); expect(host.admit).not.toHaveBeenCalled(); expect(host.invoke).toHaveBeenCalledTimes(1);
});

it.each(["replace target", "remove target", "replace confirmation", "remove confirmation", "visibility"])("withdraws %s declaration changes during consent until remount", async change => {
  const host = setup(); await host.draw(); host.button().click();
  if (change === "replace target") host.action.invoke = create(RpcCallSchema, { service: "Rows", method: "Delete" }); if (change === "remove target") host.action.invoke = undefined;
  if (change === "replace confirmation") host.action.confirm = { ...host.action.confirm!, message: "Replacement consent" }; if (change === "remove confirmation") host.action.confirm = undefined;
  if (change === "visibility") host.action.visibleWhen = "phase==true";
  host.confirm(); await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false)); host.button().click(); expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.button().disabled).toBe(true);
  expect(host.root.textContent).toContain("Update the view before retrying.");
});

it("cannot activate a stale visible control after its row ceases to match", async () => {
  const host = setup(false); await host.draw(); host.row.phase = true; host.button().click(); await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false)); expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.admit).not.toHaveBeenCalled(); expect(host.button().disabled).toBe(true);
});
