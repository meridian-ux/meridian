// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { renderPanel } from "../src/uiview/renderer.js";

const context = {
  currentResourcePath: null,
  uiIdentity: null,
  selectedRow: null,
  formValues: {},
};

const wasm = {
  renderTable: () => [],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: (_rpc: Uint8Array, ctx: typeof context) => ({ selected: ctx.selectedRow }),
  renderTablePanel: () => [],
  formatLroMetadata: () => "",
};

const descriptor = create(PanelDescriptorSchema, {
  panelId: "workspaces",
  title: "Workspaces",
  body: {
    case: "resourceCards",
    value: {
      populate: { service: "workspace.Workspaces", method: "List" },
      rowsField: "items",
      itemNoun: "workspaces",
      template: {
        titleField: "name",
        subtitleField: "repo",
        statusField: "phase",
        meta: [{ label: "Region", fieldPath: "region" }],
        actions: {
          actions: [
            { id: "resume", label: "Resume", visibleWhen: "phase==Suspended", invoke: { service: "workspace.Workspaces", method: "Resume" } },
            {
              id: "delete",
              label: "Delete",
              style: 3,
              invoke: { service: "workspace.Workspaces", method: "Delete" },
              confirm: { title: "Delete workspace?", message: "This cannot be undone.", confirmLabel: "Delete" },
            },
          ],
        },
      },
    },
  },
});

describe("ResourceCardPanel (web-components)", () => {
  it("fetches rows, applies visibility predicates, and confirms actions", async () => {
    const calls: Array<{ method: string; request: object }> = [];
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor,
      context,
      invoker: {
        invoke: async (service, method, request) => {
          calls.push({ method, request });
          return method === "List" ? { items: [{ name: "Dev", repo: "meridian", phase: "Suspended", region: "us-east" }] } : {};
        },
      },
    });

    expect(root.querySelector(".mer-resource-card-title")?.textContent).toBe("Dev");
    expect(root.querySelector(".mer-resource-card-subtitle")?.textContent).toBe("meridian");
    expect(root.querySelectorAll(".mer-resource-action")).toHaveLength(2);

    (root.querySelector(".mer-resource-action-danger") as HTMLButtonElement).click();
    expect(root.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(calls.map((call) => call.method)).toEqual(["List"]);

    const confirm = [...root.querySelectorAll('[role="alertdialog"] button')].find(
      (button) => button.textContent === "Delete",
    );
    (confirm as HTMLButtonElement).click();
    expect(calls.map((call) => call.method)).toEqual(["List", "Delete"]);
    expect((calls[1].request as { selected: { name: string } }).selected.name).toBe("Dev");
  });
});
