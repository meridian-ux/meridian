// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  SlotSchema,
  TabbedLayoutSchema,
  ViewDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { renderView } from "../src/uiview/view_renderer.js";

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
