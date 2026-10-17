// @vitest-environment jsdom

import { create, fromBinary } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  SlotSchema,
  TabbedLayoutSchema,
  ViewDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { disposeView, renderView } from "../src/uiview/view_renderer.js";
import { mermaidGrammarFixture } from "./fixtures.js";

const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const wasm = {
  renderTable: () => [],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: () => ({}),
  renderTablePanel: () => [],
  formatLroMetadata: () => "",
};

describe("renderView nested composition", () => {
  it("releases the shared view-node budget when a nested tab unmounts", async () => {
    const root = document.createElement("div");
    await renderView({ root, wasm, context, invoker: { invoke: async () => ({}) }, view: create(ViewDescriptorSchema, {
      layout: { mode: { case: "tabbed", value: {} } }, slots: [
        { id: "large", placement: { tabLabel: "Nested" }, subView: { slots: Array.from({ length: 498 }, (_, i) => ({ id: `deep-${i}`, title: `Region ${i}` })) } },
        { id: "other", placement: { tabLabel: "Other" } },
      ],
    }) });
    try {
      const tabs = root.querySelectorAll<HTMLButtonElement>(':scope > .meridian-uiview-view-body > [role="tablist"] > button');
      expect(root.querySelector('[data-slot="deep-497"]')).not.toBeNull();
      tabs[1].click(); tabs[0].click();
      await vi.waitFor(() => expect(root.querySelector('[data-slot="deep-497"]')).not.toBeNull());
      expect(root.querySelector('[role="alert"]')).toBeNull();
    } finally { disposeView(root); }
  });

  it.each(["cycle", "depth", "wide"])("rejects a %s composition before fetching", async kind => {
    let view = create(ViewDescriptorSchema, { slots: [{ id: "leaf", panel: { body: { case: "table", value: { populate: { service: "demo", method: "List" } } } } }] });
    if (kind === "cycle") view.slots[0].subView = view;
    if (kind === "depth") for (let i = 0; i < 65; i++) view = create(ViewDescriptorSchema, { slots: [{ id: "nested", subView: view }] });
    if (kind === "wide") view.slots = Array.from({ length: 1001 }, (_, i) => create(SlotSchema, { id: String(i) }));
    const root = document.createElement("div"), invoke = vi.fn(async () => ({}));
    await renderView({ root, wasm, context, invoker: { invoke }, view });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("composition limit");
    expect(invoke).not.toHaveBeenCalled(); disposeView(root);
  });

  it("recursively disposes nested subscriptions when a gate closes", async () => {
    const root = document.createElement("div"), close = vi.fn(), subscribe = vi.fn(() => ({ close }));
    const view = create(ViewDescriptorSchema, { layout: { mode: { case: "tabbed", value: {} } }, slots: [{
      id: "gated", placement: { tabLabel: "Live section" }, dependsOnSelectionKey: "scope", subView: {
        slots: [{ id: "stream", panel: { body: { case: "stream", value: { subscribe: { service: "demo.Logs", method: "Watch" } } } } }],
      },
    }] });
    const opts = { root, view, wasm: { ...wasm, WasmPayloadBudget: class { admit() { return 0; } } }, invoker: { invoke: async () => ({}) }, streamInvoker: { subscribe } };
    await renderView({ ...opts, context: { ...context, selections: { scope: "open" } } });
    expect(subscribe).toHaveBeenCalledOnce();
    await renderView({ ...opts, context: { ...context, selections: {} } });
    expect(close).toHaveBeenCalledOnce();
    expect(root.querySelector('[role="tab"]')?.textContent).toBe("Live section");
    expect(root.textContent).toContain("Make a selection");
    disposeView(root); expect(close).toHaveBeenCalledOnce();
  });

  it("renders a static nested view in preference to its legacy panel", async () => {
    const root = document.createElement("div"), invoke = vi.fn(async () => ({}));
    await renderView({ root, wasm, context, invoker: { invoke }, view: create(ViewDescriptorSchema, {
      title: "Outer", slots: [{ id: "nested", panel: { title: "Legacy panel" }, subView: {
        title: "Nested heading", slots: [{ id: "inner", title: "Nested region" }],
      } }],
    }) });
    try {
      expect(root.textContent).toContain("Nested heading");
      expect(root.textContent).toContain("Nested region");
      expect(root.textContent).not.toContain("Legacy panel");
      expect(invoke).not.toHaveBeenCalled();
    } finally { disposeView(root); }
  });

  it.each([undefined, null, "", false, 0])("keeps a falsey selection gate closed (%s) without fetching", async value => {
    const root = document.createElement("div"), invoke = vi.fn(async () => ({}));
    await renderView({ root, wasm, context: { ...context, selections: value === undefined ? {} : { scope: value } }, invoker: { invoke }, view: create(ViewDescriptorSchema, {
      slots: [{ id: "scoped", title: "Scoped", dependsOnSelectionKey: "scope", dependsOnPlaceholder: "Choose a scope first", panel: {
        body: { case: "table", value: { populate: { service: "demo.Scoped", method: "List" } } },
      } }],
    }) });
    try {
      expect(invoke).not.toHaveBeenCalled();
      expect(root.textContent).toContain("Choose a scope first");
      expect(root.querySelector('[data-awaiting-selection="scope"]')).not.toBeNull();
    } finally { disposeView(root); }
  });
});

describe("renderView tab keyboard navigation", () => {
  it.each(["list", "stacked", "tabbed", "twoColumn"] as const)("partitions header rows under %s without inventing unlabeled tabs", async mode => {
    const root = document.createElement("div");
    await renderView({ root, wasm, context, invoker: { invoke: async () => ({}) }, view: create(ViewDescriptorSchema, {
      layout: { mode: { case: mode, value: {} } }, slots: [
        { id: "last", position: 2, title: "Last" },
        { id: "header", position: 5, title: "Header", placement: { headerRow: true, tabLabel: "Not a tab" } },
        { id: "first", position: 1, title: "First" },
        { id: "tied", position: 1, title: "Tied" },
      ],
    }) });
    expect([...root.querySelectorAll("header [data-slot]")].map(section => (section as HTMLElement).dataset.slot)).toEqual(["header"]);
    expect([...root.querySelectorAll(".meridian-uiview-view-body [data-slot]")].map(section => (section as HTMLElement).dataset.slot)).toEqual(["first", "tied", "last"]);
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    disposeView(root);
  });

  it("keeps reused slot IDs unique across view roots and expands unlabeled regions", async () => {
    const roots = [document.createElement("div"), document.createElement("div")];
    document.body.append(...roots);
    try {
      for (const root of roots) await renderView({ root, wasm, context, invoker: { invoke: async () => ({}) }, view: create(ViewDescriptorSchema, {
        layout: { mode: { case: "tabbed", value: {} } }, slots: [
          { id: "same", title: "Region" },
          { id: "same", placement: { tabLabel: "One" } },
          { id: "same", placement: { tabLabel: "Two" } },
        ],
      }) });
      const controls = roots.flatMap(root => [...root.querySelectorAll<HTMLElement>('[role="tab"],[role="tabpanel"]')]);
      expect(new Set(controls.map(control => control.id)).size).toBe(8);
      for (const root of roots) expect(root.querySelectorAll('[data-slot="same"]')).toHaveLength(2); // Region + selected tab only.
    } finally { for (const root of roots) { disposeView(root); root.remove(); } }
  });

  it("closes a hidden stream and view disposal is idempotent", async () => {
    const root = document.createElement("div"), close = vi.fn(), subscribe = vi.fn(() => ({ close }));
    await renderView({ root, wasm: { ...wasm, WasmPayloadBudget: class { admit() { return 0; } } }, context,
      invoker: { invoke: async () => ({}) }, streamInvoker: { subscribe }, view: create(ViewDescriptorSchema, {
        layout: { mode: { case: "tabbed", value: {} } }, slots: [
          { id: "live", placement: { tabLabel: "Live" }, panel: { body: { case: "stream", value: { subscribe: { service: "demo.Logs", method: "Watch" } } } } },
          { id: "other", title: "Other", placement: { tabLabel: "Other" } },
        ],
      }) });
    expect(subscribe).toHaveBeenCalledOnce();
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
    expect(close).toHaveBeenCalledOnce();
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0].click();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    disposeView(root); disposeView(root);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("stops an obsolete render after a pending header and disables detached actions", async () => {
    const root = document.createElement("div");
    let finish!: (value: object) => void;
    const invoke = vi.fn((_service: string, method: string, _request: object) => method === "Header" ? new Promise<object>(resolve => { finish = resolve; }) : Promise.resolve({}));
    const old = renderView({ root, wasm, context, invoker: { invoke }, admission: "unrestricted", view: create(ViewDescriptorSchema, {
      title: "Old view", actions: [{ label: "Old action", call: { service: "demo", method: "Mutate" } }], slots: [
        { id: "header", placement: { headerRow: true }, panel: { body: { case: "table", value: { populate: { service: "demo", method: "Header" } } } } },
        { id: "never", panel: { body: { case: "table", value: { populate: { service: "demo", method: "Never" } } } } },
      ],
    }) });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const detached = root.querySelector<HTMLButtonElement>("button")!;
    await renderView({ root, wasm, context, invoker: { invoke }, view: create(ViewDescriptorSchema, { title: "Replacement" }) });
    finish({}); await old; detached.click();
    expect(invoke).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("Replacement");
    expect(root.textContent).not.toContain("Old view");
    disposeView(root);
  });

  it("uses manual activation, roving focus, and associated panels", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const view = create(ViewDescriptorSchema, {
      id: "settings",
      title: "Settings",
      layout: { mode: { case: "tabbed", value: create(TabbedLayoutSchema, {}) } },
      slots: [
        create(SlotSchema, { id: "general", title: "General", placement: { tabLabel: "General", tabPosition: 0 } }),
        create(SlotSchema, { id: "advanced", title: "Advanced", placement: { tabLabel: "Advanced", tabPosition: 1 } }),
      ],
    });
    await renderView({
      root,
      view,
      wasm,
      context,
      invoker: { invoke: async () => ({}) },
    });

    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(tabs[1].getAttribute("aria-selected")).toBe("true"));
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }
    disposeView(root); root.remove();
  });

  it("partitions header/persistent regions, orders labeled tabs, and fetches only activated content", async () => {
    const root = document.createElement("div"), invoke = vi.fn(async (_service: string, _method: string, _request: object) => ({}));
    const table = (method: string) => ({ body: { case: "table" as const, value: { populate: { service: "demo.Read", method }, rowsField: "items" } } });
    await renderView({ root, wasm, context, invoker: { invoke }, view: create(ViewDescriptorSchema, {
      title: "Sections", layout: { mode: { case: "tabbed", value: {} } }, slots: [
        { id: "second", position: 0, placement: { tabLabel: "Second", tabPosition: 2 }, panel: table("Second") },
        { id: "header", position: 4, title: "Header region", placement: { headerRow: true, tabLabel: "Not a tab" } },
        { id: "summary", position: 2, title: "Persistent summary", panel: table("Summary") },
        { id: "first", position: 3, placement: { tabLabel: "First", tabPosition: 1 }, panel: table("First") },
      ],
    }) });
    try {
      expect(root.querySelector("header [data-slot=header]")).not.toBeNull();
      expect(root.querySelector(".meridian-uiview-view-body [data-slot=header]")).toBeNull();
      const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      expect(tabs.map(tab => tab.textContent)).toEqual(["First", "Second"]);
      expect(root.querySelector('[data-slot="summary"]')!.closest('[role="tabpanel"]')).toBeNull();
      expect(invoke.mock.calls.map(call => call[1])).toEqual(["Summary", "First"]);
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(invoke).toHaveBeenCalledTimes(2);
      tabs[1].click();
      await vi.waitFor(() => expect(invoke.mock.calls.map(call => call[1])).toEqual(["Summary", "First", "Second"]));
      expect(root.querySelector('[data-slot="summary"]')).not.toBeNull();
      expect(root.querySelector('[data-slot="first"]')).toBeNull();
    } finally { disposeView(root); }
  });
});

describe("renderView admission", () => {
  it.each(["view", "slot"])("passes %s action bindings and current context through the WASM request seam", async (location) => {
    const root = document.createElement("div");
    const call = create(RpcCallSchema, { service: "demo.Items", method: "Save", bindings: [
      { requestField: "kind", source: { case: "literal", value: "item" } },
      { requestField: "record", source: { case: "nested", value: { fields: [
        { requestField: "id", source: { case: "rowField", value: "id" } },
      ] } } },
    ] });
    const action = { label: "Save", call };
    const current = { ...context, selectedRow: { id: "first" }, formValues: { enabled: false, count: 0 } };
    const buildRequest = vi.fn((bytes: Uint8Array, ctx: typeof current) => {
      expect(fromBinary(RpcCallSchema, bytes)).toEqual(call);
      expect(ctx).toBe(current);
      return new Map<string, unknown>([["kind", "item"], ["record", new Map([["id", ctx.selectedRow.id]])],
        ["enabled", ctx.formValues.enabled], ["count", ctx.formValues.count]]);
    });
    const invoke = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    await renderView({ root, context: current, wasm: { ...wasm, buildRequest }, admission: "unrestricted",
      invoker: { invoke }, view: create(ViewDescriptorSchema, location === "view"
        ? { actions: [action] } : { slots: [{ id: "details", actions: [action] }] }),
    });
    root.querySelector("button")!.click();
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe("offline"));
    current.selectedRow = { id: "second" };
    root.querySelector("button")!.click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls.map(args => args[2])).toEqual([
      { kind: "item", record: { id: "first" }, enabled: false, count: 0 },
      { kind: "item", record: { id: "second" }, enabled: false, count: 0 },
    ]);
    expect(buildRequest).toHaveBeenCalledTimes(2);
  });

  it("denies bound actions before request building or transport", async () => {
    const root = document.createElement("div");
    const buildRequest = vi.fn();
    const invoke = vi.fn();
    const onDenied = vi.fn();
    await renderView({ root, wasm: { ...wasm, buildRequest }, context, invoker: { invoke }, admission: { onDenied },
      view: create(ViewDescriptorSchema, { actions: [{ label: "Save", call: { service: "demo.Items", method: "Save",
        bindings: [{ requestField: "kind", source: { case: "literal", value: "item" } }] } }] }),
    });
    root.querySelector("button")!.click();
    await vi.waitFor(() => expect(onDenied).toHaveBeenCalledTimes(1));
    expect(buildRequest).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("exposes failures and permits retry with the unchanged request", async () => {
    const root = document.createElement("div");
    const calls: unknown[] = [];
    await renderView({ root, wasm, context, admission: "unrestricted",
      view: create(ViewDescriptorSchema, { actions: [{ label: "Save", call: { service: "demo.Items", method: "Save" } }] }),
      invoker: { invoke: async (...args) => { calls.push(args); if (calls.length === 1) throw new Error("<b>offline</b>"); return {}; } },
    });
    const button = root.querySelector("button")!;
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("<b>offline</b>");
    expect(root.querySelector("b")).toBeNull();
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls).toEqual([["demo.Items", "Save", {}], ["demo.Items", "Save", {}]]);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Completed.");
  });
  it("gates view-level call actions as mutations", async () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    const view = create(ViewDescriptorSchema, {
      id: "orders",
      title: "Orders",
      actions: [{ id: "delete", label: "Delete", call: { service: "acme.Orders", method: "DeleteOrder" } }],
      layout: { mode: { case: "list", value: {} } },
    });
    await renderView({
      root,
      view,
      wasm,
      context,
      invoker: {
        invoke: async (_service, method) => {
          calls.push(method);
          return {};
        },
      },
      admission: {},
    });

    const button = root.querySelector(".meridian-uiview-actions button") as HTMLButtonElement;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(root.querySelector(".mer-action-feedback")?.textContent).toBe("Unavailable: this action is not permitted.");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([]);
    expect(button.dataset.error).toMatch(/admission\.mutations/);
  });

  it("forwards a view action only when its method is explicitly allowed", async () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    const view = create(ViewDescriptorSchema, {
      id: "orders",
      title: "Orders",
      actions: [{ id: "archive", label: "Archive", call: { service: "acme.Orders", method: "ArchiveOrder" } }],
      layout: { mode: { case: "list", value: {} } },
    });
    await renderView({
      root,
      view,
      wasm,
      context,
      invoker: {
        invoke: async (_service, method) => {
          calls.push(method);
          return {};
        },
      },
      admission: { mutations: ["acme.Orders/ArchiveOrder"] },
    });

    (root.querySelector(".meridian-uiview-actions button") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["ArchiveOrder"]);
  });
});

describe("renderView host capability forwarding", () => {
  it("forwards renderGrammar into a grammar panel nested in a slot", async () => {
    const root = document.createElement("div");
    const seen: string[] = [];
    const view = create(ViewDescriptorSchema, {
      id: "dashboard",
      title: "Dashboard",
      layout: { mode: { case: "list", value: {} } },
      slots: [
        create(SlotSchema, {
          id: "flow",
          panel: mermaidGrammarFixture,
        }),
      ],
    });

    await renderView({
      root,
      view,
      wasm,
      context,
      invoker: { invoke: async () => ({}) },
      renderGrammar: ({ language, source }) => {
        seen.push(`${language}:${source}`);
        const hostOutput = document.createElement("div");
        hostOutput.className = "host-view-grammar";
        return hostOutput;
      },
    });

    expect(seen).toEqual(["mermaid:graph TD; A-->B"]);
    expect(root.querySelector(".host-view-grammar")).toBeTruthy();
    expect(root.querySelector(".mer-grammar-fallback")).toBeNull();
  });
});
