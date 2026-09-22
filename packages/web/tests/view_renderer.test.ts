// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  SlotSchema,
  TabbedLayoutSchema,
  ViewDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { renderView } from "../src/uiview/view_renderer.js";
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

describe("renderView tab keyboard navigation", () => {
  it("uses roving tabindex and wraps arrow navigation", async () => {
    const root = document.createElement("div");
    const view = create(ViewDescriptorSchema, {
      id: "settings",
      title: "Settings",
      layout: { mode: { case: "tabbed", value: create(TabbedLayoutSchema, {}) } },
      slots: [
        create(SlotSchema, { id: "general", title: "General", placement: { tabPosition: 0 } }),
        create(SlotSchema, { id: "advanced", title: "Advanced", placement: { tabPosition: 1 } }),
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
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });
});

describe("renderView admission", () => {
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
