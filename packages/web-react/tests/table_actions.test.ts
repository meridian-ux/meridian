// @vitest-environment jsdom
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema, type PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FieldBindingSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { PaginationMode, PaginationSchema, RowActionSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { AdmissionPolicy, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianSelectionContext, type MeridianSelection } from "../src/pagination.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  { id: "build-1", name: "Building", phase: "Building", owner: { id: "owner-1" }, created: "2026-03-29", enabled: true, count: 1, note: "draft" },
  { id: "build-2", name: "Ready", phase: "Succeeded", owner: { id: "owner-2" }, created: "2026-03-30", enabled: false, count: 0, note: "" },
];

function fixture() {
  return create(PanelDescriptorSchema, { panelId: "builds", title: "Builds", body: { case: "table", value: {
    populate: { service: "demo.Builds", method: "List" }, rowsField: "items", placeholder: "No builds.",
    columns: [
      { header: "Name", fieldPath: "name" },
      { header: "Created", fieldPath: "created", valueDisplay: { type: ValueType.DATE } },
      { header: "Enabled", fieldPath: "enabled", valueDisplay: { type: ValueType.BOOLEAN } },
      { header: "Owner", fieldPath: "owner.id", link: { targetKind: "member" } },
    ],
    actions: [
      { label: "Inspect", rpc: { service: "demo.Builds", method: "Inspect", bindings: [
        { requestField: "name", source: { case: "rowField", value: "id" } },
        { requestField: "mode", source: { case: "literal", value: "audit" } },
        { requestField: "empty", source: { case: "literal", value: "" } },
        { requestField: "payload", source: { case: "nested", value: { fields: [
          { requestField: "owner.id", source: { case: "rowField", value: "owner.id" } },
          { requestField: "created", source: { case: "rowField", value: "created" } },
          { requestField: "enabled", source: { case: "rowField", value: "enabled" } },
          { requestField: "count", source: { case: "rowField", value: "count" } },
          { requestField: "note", source: { case: "rowField", value: "note" } },
          { requestField: "scope", source: { case: "selectionKey", value: "scope" } },
          { requestField: "unset", source: { case: "selectionKey", value: "unset" } },
          { requestField: "missing", source: { case: "rowField", value: "absent.id" } },
          { requestField: "form", source: { case: "formField", value: "id" } },
        ] } } },
        { requestField: "__proto__.meridianTableTest", source: { case: "literal", value: "unsafe" } },
      ] } },
      { label: "Archive", rpc: { service: "demo.Builds", method: "Archive" },
        enabledWhen: { fieldPath: "phase", equals: "Succeeded" }, refreshOnSuccess: true },
    ],
  } } });
}

function table(descriptor: PanelDescriptor) {
  if (descriptor.body.case !== "table") throw new Error("Expected a table fixture");
  return descriptor.body.value;
}

function deferred() {
  let resolve!: (value: object) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<object>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function rows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]"));
}

function buttons(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Row actions"] button'));
}

function selected(container: HTMLElement) {
  return rows(container).map(row => row.getAttribute("aria-selected"));
}

describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s table row actions", (_name, kit) => {
  async function mount(descriptor: PanelDescriptor, invoke: RpcInvoker["invoke"], options: {
    admission?: AdmissionPolicy; selection?: MeridianSelection;
  } = {}) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const provider = { kit, adhoc: {}, invoker: { invoke }, admission: options.admission ?? "unrestricted" as const,
      resolveHref: (kind: string, id: string) => `/${kind}/${id}` };
    const selection = options.selection ?? { values: {}, set: () => {} };
    // Exercise the wire contract; keep each decoded descriptor stable between renders.
    const decode = (value: PanelDescriptor) => fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, value));
    let current = decode(descriptor);
    async function render(next?: PanelDescriptor) {
      if (next) current = decode(next);
      await act(async () => root.render(createElement(MeridianProvider, provider,
        createElement(MeridianSelectionContext.Provider, { value: selection }, createElement(PanelRenderer, { descriptor: current })))));
    }
    await render();
    return { container, render, close: async () => { await act(async () => root.unmount()); container.remove(); } };
  }

  it("selects raw rows by pointer, Enter, and Space and evaluates filters without changing cell displays", async () => {
    const descriptor = fixture();
    table(descriptor).actions.push(...[
      { label: "False value", enabledWhen: { fieldPath: "enabled", equals: "false" } },
      { label: "Zero value", enabledWhen: { fieldPath: "count", equals: "0" } },
      { label: "Nested value", enabledWhen: { fieldPath: "owner.id", equals: "owner-2" } },
      { label: "Missing value", enabledWhen: { fieldPath: "missing", equals: "" } },
      { label: "Missing RPC" },
    ].map(action => create(RowActionSchema, { rpc: action.label === "Missing RPC" ? undefined : { service: "demo.Builds", method: "Inspect" }, ...action })));
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ items: ROWS }));
    const view = await mount(descriptor, invoke);
    try {
      const controls = buttons(view.container);
      expect(controls.map(button => button.textContent)).toEqual(["Inspect", "Archive", "False value", "Zero value", "Nested value", "Missing value", "Missing RPC"]);
      expect(controls.every(button => button.disabled)).toBe(true);
      expect(rows(view.container).map(row => row.tabIndex)).toEqual([0, 0]);
      expect(Array.from(rows(view.container)[1].cells, cell => cell.textContent)).toEqual(["Ready", "Mar 30, 2026", "No", "owner-2"]);
      await act(async () => rows(view.container)[0].cells[0].click());
      expect(selected(view.container)).toEqual(["true", "false"]);
      expect(controls.map(button => button.disabled)).toEqual([false, true, true, true, true, true, true]);
      rows(view.container)[1].focus();
      await act(async () => { rows(view.container)[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
      expect(document.activeElement).toBe(rows(view.container)[1]);
      expect(selected(view.container)).toEqual(["false", "true"]);
      expect(controls.map(button => button.disabled)).toEqual([false, false, false, false, false, true, true]);
      const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      await act(async () => { rows(view.container)[0].dispatchEvent(space); });
      expect(space.defaultPrevented).toBe(true);
      expect(selected(view.container)).toEqual(["true", "false"]);
      expect(invoke).toHaveBeenCalledTimes(1); // Selection itself never dials a service.
    } finally { await view.close(); }
  });

  it("keeps cell links independently navigable without selecting their row", async () => {
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ items: ROWS }));
    const view = await mount(fixture(), invoke);
    try {
      const link = rows(view.container)[1].querySelector("a")!;
      expect(link.getAttribute("href")).toBe("/member/owner-2");
      link.addEventListener("click", event => event.preventDefault());
      link.focus();
      await act(async () => link.click());
      const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      await act(async () => { link.dispatchEvent(enter); });
      expect(enter.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(link);
      expect(selected(view.container)).toEqual(["false", "false"]);
      expect(buttons(view.container).every(button => button.disabled)).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally { await view.close(); }
  });

  it("binds raw values and current scope, suppresses duplicates, retries failure, and clears selection after refresh", async () => {
    const descriptor = fixture();
    table(descriptor).actions[0].rpc!.bindings.push(
      create(FieldBindingSchema, { requestField: "ownerOverride", source: { case: "rowField", value: "owner" } }),
      create(FieldBindingSchema, { requestField: "ownerOverride.id", source: { case: "literal", value: "delegated-owner" } }),
    );
    const first = deferred();
    const retry = deferred();
    const refreshed = deferred();
    const selection = { values: { scope: "year-1", unset: "" }, set: () => {} };
    let mutations = 0;
    let reads = 0;
    const rawRows = structuredClone(ROWS);
    const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, method) => method === "List"
      ? ++reads === 1 ? { items: rawRows } : refreshed.promise
      : ++mutations === 1 ? first.promise : retry.promise);
    const view = await mount(descriptor, invoke, { selection });
    try {
      await act(async () => rows(view.container)[1].click());
      const inspect = buttons(view.container)[0];
      await act(async () => { inspect.click(); inspect.click(); });
      const request = { name: "build-2", mode: "audit", empty: "", ownerOverride: { id: "delegated-owner" }, payload: {
        owner: { id: "owner-2" }, created: "2026-03-30", enabled: false, count: 0, note: "", scope: "year-1",
      } };
      expect(invoke.mock.calls).toEqual([["demo.Builds", "List", {}], ["demo.Builds", "Inspect", request]]);
      expect(Object.hasOwn(Object.prototype, "meridianTableTest")).toBe(false);
      expect(rawRows).toEqual(ROWS);
      expect(buttons(view.container).every(button => button.disabled)).toBe(true);
      expect(inspect.getAttribute("aria-busy")).toBe("true");
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Running…");

      await act(async () => first.reject(new Error("<b>private backend details</b>")));
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("Action failed. Try again.");
      expect(view.container.textContent).not.toContain("private backend details");
      expect(view.container.querySelector("b")).toBeNull();
      expect(inspect.disabled).toBe(false);
      expect(inspect.hasAttribute("aria-busy")).toBe(false);
      expect(document.getElementById(inspect.getAttribute("aria-describedby")!)?.textContent).toBe("Action failed. Try again.");
      expect(selected(view.container)).toEqual(["false", "true"]);
      expect(reads).toBe(1);

      selection.values.scope = "year-2";
      await view.render();
      await act(async () => inspect.click());
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
      expect(invoke).toHaveBeenLastCalledWith("demo.Builds", "Inspect", { ...request, payload: { ...request.payload, scope: "year-2" } });
      await act(async () => retry.resolve({}));
      expect(reads).toBe(2); // Default refresh_on_success is also honored after wire decoding.
      expect(view.container.querySelector("table")?.getAttribute("aria-busy")).toBe("true");
      expect(buttons(view.container).every(button => button.disabled)).toBe(true);
      await act(async () => rows(view.container)[0].click());
      expect(buttons(view.container).every(button => button.disabled)).toBe(true);
      await act(async () => refreshed.resolve({ items: [{ ...ROWS[0], name: "Replacement" }] }));
      expect(selected(view.container)).toEqual(["false"]);
      expect(view.container.textContent).toContain("Replacement");
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Completed.");
      await act(async () => inspect.click());
      expect(invoke.mock.calls.map(([, method]) => method)).toEqual(["List", "Inspect", "Inspect", "List"]);
    } finally { await view.close(); }
  });

  it("reports mutation denial through the host gate while populate stays read-only", async () => {
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ items: ROWS }));
    const onDenied = vi.fn();
    const view = await mount(fixture(), invoke, { admission: { onDenied } });
    try {
      const inspect = buttons(view.container)[0];
      expect(inspect.getAttribute("aria-disabled")).toBe("true");
      expect(onDenied).not.toHaveBeenCalled();
      await act(async () => rows(view.container)[0].click());
      expect(inspect.disabled).toBe(false); // Reachable for an explanation and the host's denial callback.
      await act(async () => inspect.click());
      expect(invoke.mock.calls).toEqual([["demo.Builds", "List", {}]]);
      expect(onDenied).toHaveBeenCalledTimes(1);
      expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ tier: "mutation", service: "demo.Builds", method: "Inspect" }));
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("This action is unavailable.");
      expect(document.getElementById(inspect.getAttribute("aria-describedby")!)?.textContent).toBe("This action is unavailable.");
      expect(selected(view.container)).toEqual(["true", "false"]);
    } finally { await view.close(); }
  });

  it("sends an empty request for an unbound action and shows a failed refresh separately", async () => {
    let reads = 0;
    const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, method) => {
      if (method !== "List") return {};
      if (++reads === 1) return { items: ROWS };
      throw new Error("private read failure");
    });
    const view = await mount(fixture(), invoke);
    try {
      await act(async () => rows(view.container)[1].click());
      await act(async () => buttons(view.container)[1].click());
      expect(invoke.mock.calls).toEqual([["demo.Builds", "List", {}], ["demo.Builds", "Archive", {}], ["demo.Builds", "List", {}]]);
      expect(view.container.textContent).toContain("Failed to load table.");
      expect(view.container.textContent).not.toContain("private read failure");
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Completed.");
      expect(rows(view.container)).toHaveLength(0);
      expect(buttons(view.container).every(button => button.disabled)).toBe(true);
    } finally { await view.close(); }
  });

  it("clears selection when paging and refreshes the current server page after mutation", async () => {
    const descriptor = fixture();
    table(descriptor).pagination = create(PaginationSchema, { mode: PaginationMode.OFFSET, pageSize: 1,
      offsetRequestField: "page.offset", limitRequestField: "page.limit", totalField: "total" });
    const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, method, request) => method === "List"
      ? { items: [ROWS[(request as { page: { offset: number } }).page.offset]], total: 2 } : {});
    const view = await mount(descriptor, invoke);
    try {
      await act(async () => rows(view.container)[0].click());
      await act(async () => view.container.querySelectorAll<HTMLButtonElement>("nav button")[1].click());
      expect(rows(view.container)[0].textContent).toContain("Ready");
      expect(selected(view.container)).toEqual(["false"]);
      expect(buttons(view.container).every(button => button.disabled)).toBe(true);
      await act(async () => rows(view.container)[0].click());
      await act(async () => buttons(view.container)[1].click());
      expect(invoke.mock.calls).toEqual([
        ["demo.Builds", "List", { page: { offset: 0, limit: 1 } }],
        ["demo.Builds", "List", { page: { offset: 1, limit: 1 } }],
        ["demo.Builds", "Archive", {}],
        ["demo.Builds", "List", { page: { offset: 1, limit: 1 } }],
      ]);
      expect(selected(view.container)).toEqual(["false"]);
    } finally { await view.close(); }
  });

  it.each(["descriptor", "selection", "unmount"] as const)("ignores late mutation completion after %s replacement", async change => {
    const descriptor = fixture();
    table(descriptor).populate!.bindings = [create(FieldBindingSchema, { requestField: "scope", source: { case: "selectionKey", value: "scope" } })];
    const selection = { values: { scope: "year-1" }, set: () => {} };
    const mutation = deferred();
    const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, method) => method === "List" ? { items: ROWS } : mutation.promise);
    const view = await mount(descriptor, invoke, { selection });
    let closed = false;
    try {
      await act(async () => rows(view.container)[0].click());
      await act(async () => buttons(view.container)[0].click());
      if (change === "descriptor") {
        const replacement = fixture();
        table(replacement).populate!.service = "demo.Replacement";
        await view.render(replacement);
      } else if (change === "selection") {
        selection.values.scope = "year-2";
        await view.render();
      } else {
        await view.close();
        closed = true;
      }
      const reads = invoke.mock.calls.filter(([, method]) => method === "List").length;
      await act(async () => mutation.resolve({}));
      expect(invoke.mock.calls.filter(([, method]) => method === "List")).toHaveLength(reads);
      expect(view.container.querySelector('[role="status"]')).toBeNull();
      if (!closed) {
        expect(selected(view.container)).toEqual(["false", "false"]);
        expect(buttons(view.container).every(button => button.disabled)).toBe(true);
      }
    } finally { if (!closed) await view.close(); }
  });

  it("leaves tables without actions nonselectable", async () => {
    const descriptor = fixture();
    table(descriptor).actions = [];
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ items: ROWS }));
    const view = await mount(descriptor, invoke);
    try {
      expect(buttons(view.container)).toHaveLength(0);
      expect(rows(view.container)).toHaveLength(0);
      const row = view.container.querySelector<HTMLTableRowElement>("tbody tr")!;
      expect(row.hasAttribute("tabindex")).toBe(false);
      expect(row.hasAttribute("aria-selected")).toBe(false);
      await act(async () => row.click());
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally { await view.close(); }
  });
});
