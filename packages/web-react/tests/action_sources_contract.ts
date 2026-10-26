import { create, toJson, type JsonObject } from "@bufbuild/protobuf";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { AffordanceCollectionSchema } from "@savvifi/meridian-proto-ts/proto/interaction_pb.js";
import { ActionPlacement, SlotSchema, ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { readFrozen } from "../../../schemas/tests/frozen_affordance.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { InvocationCapabilities, InvocationHost, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import type { ComponentKit } from "../src/component_kit.js";
import type { MeridianSelection } from "../src/pagination.js";
import type { affordanceContract } from "./affordance_contract.js";

export function actionSourcesContract(kit: ComponentKit, runtime: Parameters<typeof affordanceContract>[1] & {
  ViewRenderer: typeof import("../src/view_renderer.js").ViewRenderer;
}) {
  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterAll(() => vi.unstubAllGlobals());
  const { MeridianProvider, ViewRenderer } = runtime;
  function setup(table = false) {
    const view = create(ViewDescriptorSchema, { id: "sources", title: "Sources", subjectKind: "raw-kind", subjectId: "raw/e\u0301" });
    const row = { id: 0, label: "Row zero", state: "OPEN" };
    const panel = create(PanelDescriptorSchema, { body: { case: "table", value: {
      populate: { service: "raw.Service", method: "List" }, rowsField: "items", columns: [{ header: "Name", fieldPath: "label" }],
    } } });
    if (table) view.slots.push(create(SlotSchema, { id: "table", panel }));
    const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, method) => method === "List" ? { items: [row] } : {});
    const copy = vi.fn(async () => {}), navigate = vi.fn(async () => {}), onAction = vi.fn();
    let invocation: InvocationHost = { capabilities: { copy, navigate }, admit: () => true };
    let admission = { mutations: ["raw.Service/Get"] };
    let selection: MeridianSelection | undefined;
    const container = document.createElement("div");
    const invoker = { invoke }, adhoc = {};
    let root: ReturnType<typeof createRoot> | undefined;
    const tree = () => createElement(StrictMode, {}, createElement(MeridianProvider, { kit, invoker, adhoc, admission,
      invocation, onAction, children: createElement(ViewRenderer, { view, selection }),
    }));
    const control = (name: string) => [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")]
      .find(node => node.textContent?.trim() === name || node.getAttribute("aria-label")?.toLowerCase() === name.toLowerCase())!;
    return { view, row, panel, container, invoke, copy, navigate, onAction, control,
      get invocation() { return invocation; }, set invocation(value: InvocationHost) { invocation = value; },
      set admission(value: { mutations: string[] }) { admission = value; },
      set selection(value: MeridianSelection) { selection = value; },
      async mount() { document.body.append(container); root = createRoot(container); await act(async () => root!.render(tree())); },
      async update() { await act(async () => root!.render(tree())); },
      async click(name: string) { await act(async () => control(name).click()); },
      async selectRow() {
        if (kit.id === "mui") await act(async () => control("Row actions").click());
        else await act(async () => container.querySelector<HTMLElement>("tbody tr[data-row]")!.click());
      },
      async close() { if (root) await act(async () => root!.unmount()); container.remove(); },
    };
  }

  describe(`${kit.id} normalized action sources`, () => {
    it.each([[false, false], [false, true], [true, false], [true, true]])(
      "canonical header host consent after admission (allowed=%s consent=%s)", async (allowed, consent) => {
        const host = setup(), confirm = vi.fn<NonNullable<InvocationHost["confirm"]>>(async () => consent);
        host.admission = { mutations: allowed ? ["raw.Service/Get"] : [] };
        Object.assign(host.view, readFrozen(ViewDescriptorSchema, { ...toJson(ViewDescriptorSchema, host.view) as JsonObject, actions: [{ id: "delete", label: "Must not revive" }] }));
        host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "delete", label: "Canonical confirm",
          invoke: { case: "rpc", value: { service: "raw.Service", method: "Get" } } }] });
        host.invocation = { ...host.invocation, confirm };
        try {
          await host.mount(); expect(confirm).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
          await host.click("Canonical confirm");
          expect(confirm).toHaveBeenCalledTimes(allowed ? 1 : 0); expect(host.invoke).toHaveBeenCalledTimes(allowed && consent ? 1 : 0);
          if (allowed) expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: "delete", invoke: { case: "rpc", value: expect.objectContaining({ service: "raw.Service", method: "Get" }) } }),
            expect.any(Object), { entityType: "raw-kind", entityId: "raw/e\u0301" }, expect.any(AbortSignal));
          expect(host.container.textContent).toContain(!allowed ? "mutation policy" : consent ? "Action completed." : "Action canceled.");
          expect(host.onAction).not.toHaveBeenCalled();
        } finally { await host.close(); }
      });

    it("canonical consent is invalidated by replacement of the host confirmation callback", async () => {
      const host = setup(); let release!: (value: boolean) => void;
      const confirm = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
      const replacement = vi.fn(async () => true);
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ label: "Confirm current", invoke: { case: "copy", value: "raw" } }] });
      host.invocation = { ...host.invocation, confirm };
      try {
        await host.mount(); await host.click("Confirm current"); expect(confirm).toHaveBeenCalledTimes(1);
        host.invocation = { ...host.invocation, confirm: replacement }; await host.update();
        await act(async () => release(true)); expect(host.copy).not.toHaveBeenCalled();
        await host.click("Confirm current"); expect(replacement).toHaveBeenCalledTimes(1); expect(host.copy).toHaveBeenCalledTimes(1);
      } finally { release?.(true); await host.close(); }
    });

    it("rejects an unsafe canonical destination without invoking the host", async () => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "resolve-navigation", label: "Resolve destination", placement: ActionPlacement.HEADER,
        invoke: { case: "navigate", value: { route: "javascript:alert(1)" } },
      }] });
      try {
        await host.mount(); await host.click("Resolve destination");
        expect(host.navigate).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
        expect(host.onAction).not.toHaveBeenCalled(); expect(host.container.textContent).toContain("unsafe or missing");
      } finally { await host.close(); }
    });
    it("canonical header presence wins over legacy, including an explicit empty collection", async () => {
      const host = setup();
      Object.assign(host.view, readFrozen(ViewDescriptorSchema, { ...toJson(ViewDescriptorSchema, host.view) as JsonObject, actions: [{ id: "legacy", label: "Legacy callback" }] }));
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "canonical", label: "Canonical copy",
        placement: ActionPlacement.HEADER, invoke: { case: "copy", value: "raw" } }] });
      try {
        await host.mount();
        expect(host.container.textContent).not.toContain("Legacy callback");
        expect(host.copy).not.toHaveBeenCalled();
        await host.click("Canonical copy");
        expect(host.copy).toHaveBeenCalledWith("raw", expect.any(Object), expect.any(AbortSignal));
        host.view.affordances.items = [];
        await host.update();
        expect(host.container.querySelectorAll("button")).toHaveLength(0);
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it("slot canonical presence wins without merging old targets or bindings", async () => {
      const host = setup();
      host.view.slots.push(readFrozen(SlotSchema, { id: "slot", panel: { action: { description: "Slot content" } },
        actions: [{ id: "old", label: "Old slot", call: { service: "raw.Service", method: "Get" } }],
        affordances: { items: [{ label: "Slot copy", copy: "slot raw" }] } }));
      try {
        await host.mount(); await host.click("Slot copy");
        expect(host.copy).toHaveBeenCalledTimes(1);
        expect(host.invoke).not.toHaveBeenCalled();
        host.view.slots[0].affordances!.items = [];
        await host.update();
        expect(host.container.textContent).not.toContain("Old slot");
        expect(host.container.querySelectorAll("button")).toHaveLength(0);
      } finally { await host.close(); }
    });

    it("canonical header consent preserves exact ID and header subject", async () => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "https://semantic-not-a-uri.test", label: "Resolve header", placement: ActionPlacement.HEADER,
        invoke: { case: "navigate", value: { route: "/actual-form" } } }] });
      const confirm = vi.fn(async () => true);
      host.invocation = { ...host.invocation, confirm };
      try {
        await host.mount();
        await act(async () => host.control("Resolve header").focus());
        expect(confirm).not.toHaveBeenCalled();
        await host.click("Resolve header");
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: "https://semantic-not-a-uri.test" }), expect.any(Object),
          { entityType: "raw-kind", entityId: "raw/e\u0301" }, expect.any(AbortSignal));
        expect(host.navigate).toHaveBeenCalledWith(expect.objectContaining({ route: "/actual-form" }), expect.any(Object), expect.any(AbortSignal));
        expect(host.onAction).not.toHaveBeenCalled();
        expect(host.invoke).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it.each([false, true])("confirmation %s never grants RPC mutation permission", async consent => {
      const host = setup();
      host.admission = { mutations: [] };
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "confirm-delete", label: "Confirm", invoke: { case: "rpc", value: { service: "raw.Service", method: "Get" } } }] });
      const confirm = vi.fn(async () => consent);
      host.invocation = { ...host.invocation, confirm };
      try {
        await host.mount(); await host.click("Confirm");
        expect(confirm).not.toHaveBeenCalled();
        expect(host.invoke).not.toHaveBeenCalled();
        expect(host.container.textContent).toContain("mutation policy");
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it.each([false, true])("admitted canonical RPC honors confirmation %s", async consent => {
      const host = setup(), confirm = vi.fn(async () => consent);
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "confirm", label: "Confirm", invoke: { case: "rpc", value: { service: "raw.Service", method: "Get" } } }] });
      host.invocation = { ...host.invocation, confirm };
      try {
        await host.mount(); await host.click("Confirm");
        expect(confirm).toHaveBeenCalledTimes(1); expect(host.invoke).toHaveBeenCalledTimes(consent ? 1 : 0);
        expect(host.container.textContent).toContain(consent ? "Action completed." : "Action canceled.");
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it("subject changes during confirmation stop execution; retry asks again with current subject", async () => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "confirm", label: "Confirm", invoke: { case: "rpc", value: { service: "raw.Service", method: "Get" } } }] });
      let release!: (value: boolean) => void;
      const confirmation = new Promise<boolean>(resolve => { release = resolve; });
      const confirm = vi.fn().mockImplementationOnce(() => confirmation).mockResolvedValue(true);
      host.invocation = { ...host.invocation, confirm };
      try {
        await host.mount(); await host.click("Confirm");
        host.view.subjectId = "new/raw";
        await host.update();
        await act(async () => release(true));
        expect(host.invoke).not.toHaveBeenCalled();
        await host.click("Confirm");
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(confirm).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Object), { entityType: "raw-kind", entityId: "new/raw" }, expect.any(AbortSignal));
        expect(host.invoke).toHaveBeenCalledTimes(1);
      } finally { release(true); await host.close(); }
    });

    it("canonical denial cannot revive a same-ID legacy callback or resolver", async () => {
      const host = setup();
      host.admission = { mutations: [] };
      Object.assign(host.view, readFrozen(ViewDescriptorSchema, { ...toJson(ViewDescriptorSchema, host.view) as JsonObject, actions: [{ id: "same", label: "Legacy" }] }));
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "same", label: "Canonical",
        invoke: { case: "rpc", value: { service: "raw.Service", method: "Get" } } }] });
      try {
        await host.mount(); await host.click("Canonical");
        expect(host.onAction).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
        expect(host.container.textContent).toContain("mutation policy");
      } finally { await host.close(); }
    });

    it.each([false, true])("confirmation tolerates a new wrapper but rejects changed policy (deny=%s)", async deny => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "confirm-wrapper", label: "Confirm wrapper", invoke: { case: "rpc", value: { service: "raw.Service", method: "Get" } } }] });
      let release!: (value: boolean) => void;
      const waiting = new Promise<boolean>(resolve => { release = resolve; });
      host.invocation = { ...host.invocation, confirm: () => waiting };
      try {
        await host.mount(); await host.click("Confirm wrapper");
        host.invocation = { ...host.invocation, ...(deny ? { admit: () => false } : {}) };
        await host.update();
        await act(async () => release(true));
        expect(host.invoke).toHaveBeenCalledTimes(deny ? 0 : 1);
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { release(true); await host.close(); }
    });

    it("a live selection change during confirmation requires renewed consent without a React render", async () => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "confirm-scope", label: "Confirm scope", invoke: { case: "rpc", value: { service: "raw.Service", method: "Get",
        bindings: [{ requestField: "scope", source: { case: "selectionKey", value: "scope" } }],
      } } }] });
      let release!: (consent: boolean) => void;
      const waiting = new Promise<boolean>(resolve => { release = resolve; });
      const confirm = vi.fn().mockImplementationOnce(() => waiting).mockResolvedValue(true);
      const liveSelection = { values: { scope: "old" }, set: () => {} };
      host.selection = liveSelection;
      host.invocation = { ...host.invocation, confirm };
      try {
        await host.mount(); await host.click("Confirm scope");
        liveSelection.values.scope = "new";
        await act(async () => release(true));
        expect(host.invoke).not.toHaveBeenCalled();
        await host.click("Confirm scope");
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(host.invoke.mock.calls).toEqual([["raw.Service", "Get", { scope: "new" }]]);
      } finally { release(true); await host.close(); }
    });

    it("closing and reopening an overflow cannot replay a noncooperative pending operation", async () => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "wait", label: "Wait action", placement: ActionPlacement.OVERFLOW, invoke: { case: "copy", value: "raw" } }] });
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      let signal: AbortSignal | undefined;
      const copy = vi.fn<NonNullable<InvocationCapabilities["copy"]>>(async () => {})
        .mockImplementationOnce(async (_text, _context, abort) => { signal = abort; await waiting; });
      host.invocation = { ...host.invocation, capabilities: { copy } };
      try {
        await host.mount(); await host.click("More actions"); await host.click("Wait action");
        await act(async () => document.querySelector<HTMLElement>('[role="menu"]')!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(signal?.aborted).toBe(true);
        await host.click("More actions"); await host.click("Wait action");
        expect(copy).toHaveBeenCalledTimes(1);
        await act(async () => release());
        expect(host.control("More actions").getAttribute("aria-expanded")).toBe("true");
        await host.click("Wait action");
        expect(copy).toHaveBeenCalledTimes(2);
      } finally { release(); await host.close(); }
    });

    it("a pending action serializes other actions in the same bar", async () => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: ["First", "Second"].map(label => ({ label,
        invoke: { case: "copy" as const, value: label },
      })) });
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      host.copy.mockImplementationOnce(() => waiting);
      try {
        await host.mount(); await host.click("First");
        expect(host.control("Second").hasAttribute("disabled")).toBe(true);
        await host.click("Second"); expect(host.copy).toHaveBeenCalledTimes(1);
        await act(async () => release());
        await host.click("Second"); expect(host.copy).toHaveBeenCalledTimes(2);
      } finally { release(); await host.close(); }
    });

    it("overflow admission occurs only at activation and closes after successful execution", async () => {
      const host = setup();
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "overflow", label: "Resolve overflow", placement: ActionPlacement.OVERFLOW, invoke: { case: "copy", value: "overflow" } }] });
      const admit = vi.fn(() => true);
      host.invocation = { ...host.invocation, admit };
      try {
        await host.mount(); await host.click("More actions");
        expect(admit).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(host.control("Resolve overflow"));
        await host.click("Resolve overflow");
        expect(host.copy).toHaveBeenCalledTimes(1);
        // MUI retains the exiting popup for its animation; it must already be
        // closed, not available for another activation.
        expect(host.control("More actions").getAttribute("aria-expanded")).toBe("false");
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it.each([false, true])("row RPC uses only authored id bindings (bound=%s)", async bound => {
      const host = setup(true);
      if (host.panel.body.case !== "table") throw new Error("Expected table");
      host.panel.body.value.affordances = create(AffordanceCollectionSchema, { items: [{ label: "Run row", refreshOnSuccess: false,
        invoke: { case: "rpc", value: { service: "raw.Service", method: "Get", bindings: bound ? [{ requestField: "id", source: { case: "rowField", value: "id" } }] : [] } } }] });
      try {
        await host.mount(); await host.selectRow(); await host.click("Run row");
        expect(host.invoke.mock.calls.filter(([, method]) => method === "Get")).toEqual([["raw.Service", "Get", bound ? { id: 0 } : {}]]);
        expect(host.invoke.mock.calls.filter(([, method]) => method === "List")).toHaveLength(1);
      } finally { await host.close(); }
    });

    it("canonical table empty hides legacy table actions but not independently authored view-row intent", async () => {
      const host = setup(true);
      if (host.panel.body.case !== "table") throw new Error("Expected table");
      Object.assign(host.panel.body.value, readFrozen(TablePanelSchema, { ...toJson(TablePanelSchema, host.panel.body.value) as JsonObject, actions: [{ label: "Legacy table", rpc: { service: "raw.Service", method: "Get" } }] }));
      host.panel.body.value.affordances = create(AffordanceCollectionSchema);
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ label: "View row", placement: ActionPlacement.ROW,
        invoke: { case: "copy", value: "view row" } }] });
      try {
        await host.mount(); await host.selectRow(); await host.click("View row");
        expect(host.container.textContent).not.toContain("Legacy table");
        expect(host.invoke.mock.calls.filter(([, method]) => method === "Get")).toHaveLength(0);
        expect(host.copy).toHaveBeenCalledTimes(1);
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it("view canonical empty hides legacy view-row actions but preserves table-owned canonical intent", async () => {
      const host = setup(true);
      if (host.panel.body.case !== "table") throw new Error("Expected table");
      host.panel.body.value.affordances = create(AffordanceCollectionSchema, { items: [{ label: "Table copy", invoke: { case: "copy", value: "table" } }] });
      Object.assign(host.view, readFrozen(ViewDescriptorSchema, { ...toJson(ViewDescriptorSchema, host.view) as JsonObject, actions: [{ id: "old-row", label: "Old view row", placement: ActionPlacement.ROW }] }));
      host.view.affordances = create(AffordanceCollectionSchema);
      try {
        await host.mount(); await host.selectRow(); await host.click("Table copy");
        expect(host.container.textContent).not.toContain("Old view row");
        expect(host.copy).toHaveBeenCalledTimes(1); expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it("canonical row consent preserves zero subject IDs and the full current row", async () => {
      const host = setup(true);
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "confirm-row", label: "Resolve row", placement: ActionPlacement.ROW, invoke: { case: "copy", value: "row" } }] });
      const confirm = vi.fn(async () => true);
      host.invocation = { ...host.invocation, confirm };
      try {
        await host.mount(); await host.selectRow();
        expect(confirm).not.toHaveBeenCalled();
        await host.click("Resolve row");
        expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ id: "confirm-row" }), expect.objectContaining({ selectedRow: host.row }),
          { entityType: "raw-kind", entityId: 0 }, expect.any(AbortSignal));
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it("canonical typed row RPCs never inherit the old renderer's unbound id default", async () => {
      const host = setup(true);
      host.view.affordances = create(AffordanceCollectionSchema, { items: [{ id: "resolve-rpc", label: "Resolve RPC", placement: ActionPlacement.ROW,
        refreshOnSuccess: false, invoke: { case: "rpc", value: { service: "raw.Service", method: "Get" } },
      }] });
      try {
        await host.mount(); await host.selectRow(); await host.click("Resolve RPC");
        expect(host.invoke.mock.calls.filter(([, method]) => method === "Get")).toEqual([["raw.Service", "Get", {}]]);
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });
  });
}
