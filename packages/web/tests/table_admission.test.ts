// @vitest-environment jsdom
import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { afterEach, expect, it, vi } from "vitest";
import { disposePanel, renderPanel, type RenderPanelOptions } from "../src/uiview/renderer.js";

afterEach(() => { for (const root of document.querySelectorAll<HTMLElement>("[data-table-test]")) disposePanel(root); document.body.replaceChildren(); });
function setup(intent: JsonObject = { copy: "raw" }) {
  const root = document.createElement("div"); root.dataset.tableTest = ""; document.body.append(root);
  const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: {
    populate: { service: "Rows", method: "List" }, columns: [{ header: "Name", fieldPath: "name" }],
    actions: [{ label: "Legacy trap", rpc: { service: "Rows", method: "Delete" } }],
    affordances: { items: [fromJson(AffordanceSchema, { label: "Canonical row", ...intent })] },
  } } });
  if (descriptor.body.case !== "table") throw Error("table");
  const table = descriptor.body.value;
  const rows = [{ raw: { id: 0, name: "raw/e\u0301", phase: false }, cells: ["first"] }, { raw: { id: 2, name: "second", phase: true }, cells: ["second"] }];
  const buildRequest = vi.fn(() => { throw Error("old builder must not run"); });
  const wasm = { renderTable: () => rows, renderTablePanel: () => rows, readPath: () => null, buildPopulateRequest: () => ({}), buildRequest, formatLroMetadata: () => "" };
  const invoke = vi.fn(async (_service: string, _method: string, _request: object) => ({}));
  const cap = () => vi.fn(async (_target: unknown, _context: unknown, _signal: AbortSignal) => {});
  const caps = { uri: cap(), command: cap(), navigate: cap(), openPanel: cap(), openView: cap(), copy: cap() };
  const context = { currentResourcePath: "raw/context", uiIdentity: null, selectedRow: { id: "ambient trap" }, formValues: { zero: 0 }, selections: { scope: false } };
  const admit = vi.fn(() => true);
  const opts: RenderPanelOptions = { root, wasm, descriptor, context, invoker: { invoke }, admission: { reads: ["Rows/List"], mutations: ["Rows/Get"] }, invocation: { capabilities: caps, admit, context } };
  const button = () => root.querySelector<HTMLButtonElement>(".meridian-uiview-actions .mer-affordance")!;
  const select = (index = 0) => root.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]")[index].click();
  return { root, descriptor, table, rows, opts, context, admit, caps, invoke, buildRequest, button, select, draw: () => renderPanel(opts) };
}

it.each<JsonObject>([{ uri: "/safe" }, { command: "literal" }, { navigate: { route: "/safe" } }, { openPanel: { panelId: "inline" } }, { openView: "view" }, { copy: "literal" }])("invokes real selected-row control %j without legacy or ambient-row fallback", async intent => {
  const host = setup(intent); await host.draw(); expect(host.button().disabled).toBe(true); expect(host.admit).not.toHaveBeenCalled();
  host.select(); host.button().focus(); expect(host.admit).not.toHaveBeenCalled(); host.button().click();
  const key = Object.keys(intent)[0] as keyof typeof host.caps;
  await vi.waitFor(() => expect(host.caps[key]).toHaveBeenCalledTimes(1));
  expect(host.caps[key]).toHaveBeenCalledWith(expect.anything(), { ...host.context, selectedRow: host.rows[0].raw }, expect.any(AbortSignal));
  expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.buildRequest).not.toHaveBeenCalled();
});

it("builds mutation-tier Get through actual Rust with raw false/zero and explicit bindings", async () => {
  const host = setup({ rpc: { service: "Rows", method: "Get", bindings: [{ requestField: "id", rowField: "id" }, { requestField: "flag", rowField: "phase" }, { requestField: "name", rowField: "name" }, { requestField: "scope", selectionKey: "scope" }] } });
  await host.draw(); host.select(); host.button().click();
  await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledWith("Rows", "Get", { id: 0, flag: false, name: "raw/e\u0301", scope: false })); expect(host.invoke).toHaveBeenCalledTimes(2); expect(host.buildRequest).not.toHaveBeenCalled();
});

it.each(["empty collection", "empty intent", "missing capability", "target policy", "mutation policy"])("canonical %s never revives the legacy row call", async reason => {
  const host = setup(reason === "empty intent" ? {} : reason === "mutation policy" ? { rpc: { service: "Rows", method: "Get" } } : undefined);
  if (reason === "empty collection") host.table.affordances!.items = [];
  if (reason === "missing capability") host.opts.invocation = { ...host.opts.invocation, capabilities: {} };
  if (reason === "target policy") host.admit.mockReturnValue(false);
  if (reason === "mutation policy") host.opts.admission = { reads: ["Rows/List", "Rows/Get"] };
  await host.draw();
  if (reason === "empty collection") { expect(host.button()).toBeNull(); expect(host.root.querySelector("tbody tr[tabindex]")).toBeNull(); }
  else { host.select(); host.button().click(); await vi.waitFor(() => expect(host.root.textContent).toMatch(/Action (denied|unavailable)/)); }
  expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.caps.copy).not.toHaveBeenCalled();
});

it("retains native selection keys and enabledWhen filtering", async () => {
  const host = setup({ copy: "raw", enabledWhen: { fieldPath: "phase", equals: "true" } }); await host.draw(); host.select(); expect(host.button().disabled).toBe(true);
  const second = host.root.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]")[1]; second.focus(); second.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  expect(second.getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(second); expect(host.button().disabled).toBe(false); host.button().click(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
});

it("shares pending guard across row controls and cancellation until noncooperative settlement", async () => {
  const host = setup(); host.table.affordances!.items.push(fromJson(AffordanceSchema, { label: "Other", copy: "other" })); let settle!: () => void;
  host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; })); await host.draw(); host.select(); host.button().focus(); host.button().click();
  await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1)); const buttons = host.root.querySelectorAll<HTMLButtonElement>(".mer-affordance");
  expect(buttons[0].disabled).toBe(false); expect(buttons[1].disabled).toBe(true);
  const cancel = [...host.root.querySelectorAll("button")].find(button => button.textContent === "Cancel action" && !button.hidden)!; cancel.focus(); cancel.click();
  expect(host.caps.copy.mock.calls[0][2].aborted).toBe(true); buttons[0].click(); buttons[1].click(); expect(host.caps.copy).toHaveBeenCalledTimes(1);
  settle(); await vi.waitFor(() => expect(cancel.hidden).toBe(true)); expect(document.activeElement).toBe(buttons[0]); expect(buttons[1].disabled).toBe(false);
});

it.each(["row", "context", "dispose", "replace"])("suppresses obsolete %s result and refresh", async change => {
  const host = setup({ copy: "raw", refreshOnSuccess: true }); let settle!: () => void; host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  if (change === "row") host.select(1); if (change === "context") host.context.currentResourcePath = "replacement";
  if (change === "dispose") disposePanel(host.root); if (change === "replace") await host.draw();
  settle(); await new Promise(resolve => setTimeout(resolve, 0)); expect(host.root.textContent).not.toContain("Action completed."); expect(host.invoke).toHaveBeenCalledTimes(change === "replace" ? 2 : 1);
});

it("sanitizes failure, retains selection, and retries current selected row", async () => {
  const host = setup(); host.caps.copy.mockRejectedValueOnce(Error("private failure")); await host.draw(); host.select(); host.button().click();
  await vi.waitFor(() => expect(host.root.textContent).toContain("Action failed.")); expect(host.root.textContent).not.toContain("private failure"); expect(host.root.querySelector('[aria-selected="true"]')).not.toBeNull();
  host.select(1); host.button().click(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(2)); expect(host.caps.copy.mock.calls[1][1]).toEqual({ ...host.context, selectedRow: host.rows[1].raw });
});

it.each([false, true])("honors canonical refreshOnSuccess=%s", async refresh => {
  const host = setup({ copy: "raw", refreshOnSuccess: refresh }); await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.root.textContent).toContain("Action completed.")); expect(host.invoke).toHaveBeenCalledTimes(refresh ? 2 : 1);
});

it("reports refresh failure separately without losing selected input or replaying effect", async () => {
  const host = setup({ copy: "raw", refreshOnSuccess: true }); await host.draw(); host.invoke.mockRejectedValueOnce(Error("private refresh")); host.select(); host.button().click();
  await vi.waitFor(() => expect(host.root.textContent).toContain("Action completed, but refresh is unavailable.")); expect(host.caps.copy).toHaveBeenCalledTimes(1); expect(host.invoke).toHaveBeenCalledTimes(2);
  expect(host.root.textContent).not.toContain("private refresh"); expect(host.root.querySelector('[aria-selected="true"]')).not.toBeNull();
});

it("legacy row RPC keeps empty unbound request and refreshes without inventing an id", async () => {
  const host = setup(); host.table.affordances = undefined; host.table.actions[0].rpc!.method = "Get";
  await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(3));
  expect(host.invoke.mock.calls[1]).toEqual(["Rows", "Get", {}]); expect(host.buildRequest).not.toHaveBeenCalled();
});

it("holds the group guard before reentrant host policy/capability execution", async () => {
  const host = setup(); host.table.affordances!.items.push(fromJson(AffordanceSchema, { label: "Other", copy: "other" }));
  host.admit.mockImplementation(() => { host.root.querySelectorAll<HTMLButtonElement>(".mer-affordance")[1].click(); return true; });
  await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.root.textContent).toContain("Action completed.")); expect(host.caps.copy).toHaveBeenCalledTimes(1); expect(host.admit).toHaveBeenCalledTimes(1);
});

it("revalidates row context after admission and denies changed consent before effect", async () => {
  const host = setup(); host.admit.mockImplementation(() => { host.rows[0].raw.name = "changed during policy"; return true; });
  await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false)); expect(host.admit).toHaveBeenCalledTimes(1); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).toHaveBeenCalledTimes(1);
});

it("rejects accessor row data without invoking it or falling back", async () => {
  const host = setup(); const getter = vi.fn(() => "private"); Object.defineProperty(host.rows[0].raw, "hiddenContext", { enumerable: true, get: getter });
  await host.draw(); host.select(); host.button().click(); expect(getter).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).toHaveBeenCalledTimes(1);
});

it("ignores a late refresh after replacement without erasing the new table", async () => {
  const host = setup({ copy: "raw", refreshOnSuccess: true }); await host.draw(); let finish!: (value: object) => void;
  host.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); host.select(); host.button().click(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(2));
  await host.draw(); const replacement = host.root.querySelector("table"); finish({}); await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.root.querySelector("table")).toBe(replacement); expect(host.root.querySelector('[aria-selected="true"]')).toBeNull(); expect(host.root.textContent).not.toContain("Action completed."); expect(host.caps.copy).toHaveBeenCalledTimes(1);
});

it.each(["selection", "context", "cancel"])("ignores late refresh data after %s changes", async change => {
  const host = setup({ copy: "raw", refreshOnSuccess: true }); await host.draw(); let finish!: (value: object) => void;
  host.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); host.select(); host.button().click(); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(2));
  const originalTable = host.root.querySelector("table");
  if (change === "selection") host.select(1); if (change === "context") host.context.currentResourcePath = "changed during refresh";
  if (change === "cancel") [...host.root.querySelectorAll("button")].find(button => button.textContent === "Cancel action" && !button.hidden)!.click();
  finish({}); await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false));
  expect(host.root.querySelector("table")).toBe(originalTable); expect(host.caps.copy).toHaveBeenCalledTimes(1); expect(host.invoke).toHaveBeenCalledTimes(2);
  expect(host.root.querySelector('[aria-selected="true"]')?.textContent).toBe(change === "selection" ? "second" : "first"); expect(host.root.textContent).not.toContain("Action completed.");
});

it("treats equal-valued rows as distinct selection scopes before effect", async () => {
  const host = setup(); host.rows[1].raw = { ...host.rows[0].raw }; host.admit.mockImplementation(() => { host.select(1); return true; });
  await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false));
  expect(host.admit).toHaveBeenCalledTimes(1); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).toHaveBeenCalledTimes(1);
});

it("keeps equal-valued replacement selection guarded through old settlement", async () => {
  const host = setup({ copy: "raw", refreshOnSuccess: true }); host.rows[1].raw = { ...host.rows[0].raw }; let settle!: () => void;
  host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; })); await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  host.select(1); expect(host.caps.copy.mock.calls[0][2].aborted).toBe(true); host.button().click(); expect(host.caps.copy).toHaveBeenCalledTimes(1);
  settle(); await vi.waitFor(() => expect(host.button().hasAttribute("aria-busy")).toBe(false)); expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.root.textContent).not.toContain("Action completed.");
});

it("never reads an ambient selectedRow accessor when panel selection is authoritative", async () => {
  const host = setup(); const getter = vi.fn(() => { throw Error("ambient row must not be read"); }); Object.defineProperty(host.context, "selectedRow", { enumerable: true, get: getter });
  await host.draw(); host.select(); host.button().click(); await vi.waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  expect(getter).not.toHaveBeenCalled(); expect((host.caps.copy.mock.calls[0][1] as { selectedRow: unknown }).selectedRow).toEqual(host.rows[0].raw);
});
