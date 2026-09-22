// @vitest-environment jsdom

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ValueType, PrincipalDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { renderPanel } from "../src/uiview/renderer.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { POPULATED_RESPONSES } from "../../../schemas/conformance/populated.js";

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
        meta: [{ label: "Region", fieldPath: "region", display: { type: ValueType.DATE } }],
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
  it("applies declared displays to resource-card title slots", async () => {
    const panel = create(PanelDescriptorSchema, {
      body: {
        case: "resourceCards",
        value: {
          populate: { service: "demo.Items", method: "List" },
          rowsField: "items",
          template: {
            titleField: "created",
            titleDisplay: { type: ValueType.DATE },
            subtitleField: "owner",
            subtitleDisplay: {
              type: ValueType.PRINCIPAL,
              options: {
                case: "principal",
                value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE },
              },
            },
            statusField: "created",
            statusDisplay: { type: ValueType.DATE },
          },
        },
      },
    });
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, panel)),
      invoker: { invoke: async () => ({ items: [{ created: "2026-03-29", owner: "Ada <ada@example.com>" }] }) },
      context,
    });
    expect(root.querySelector(".mer-resource-card-title")?.textContent).toBe("Mar 29, 2026");
    expect(root.querySelector(".mer-resource-card-subtitle")?.textContent).toBe("Ada");
    expect(root.querySelector(".mer-resource-card-subtitle")?.getAttribute("title")).toBe("ada@example.com");
    expect(root.querySelector(".mer-resource-card-status")?.textContent).toBe("Mar 29, 2026");
  });

  it("renders the canonical populated resource-card scenario after wire decoding", async () => {
    const fixture = FIXTURES.find((candidate) => candidate.shape === "resource_cards")!;
    const descriptor = fromBinary(
      PanelDescriptorSchema,
      toBinary(PanelDescriptorSchema, fixture.descriptor),
    );
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor,
      invoker: { invoke: async () => POPULATED_RESPONSES.resource_cards },
      context,
    });
    expect(root.querySelectorAll(".mer-resource-card")).toHaveLength(2);
    expect(root.textContent).toContain("GitHub");
    expect(root.textContent).toContain("Source control");
    expect(root.textContent).toContain("PagerDuty");
    expect(root.textContent).toContain("Incident response");
  });

  it("preserves legacy scalars, titles, and host route precedence after wire decoding", async () => {
    const row = { raw: "2026-03-29", missing: null, tags: ["a", "b"], owner: "Ada <ada@example.com>",
      safe: "https://example.com", unsafe: "data:text/html,bad", id: "user/7" };
    const panel = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
      populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
        meta: [
          { label: "Raw", fieldPath: "raw" }, { label: "Missing", fieldPath: "missing" }, { label: "Tags", fieldPath: "tags" },
          { label: "Owner", fieldPath: "owner", display: { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
          { label: "Safe", fieldPath: "safe", display: { type: ValueType.URL } },
          { label: "Unsafe", fieldPath: "unsafe", display: { type: ValueType.URL } },
          { label: "Record", fieldPath: "id", display: { type: ValueType.IDENTIFIER, link: { targetKind: "user" } } },
          { label: "Declined", fieldPath: "safe", display: { type: ValueType.URL, link: { targetKind: "declined" } } },
          { label: "Empty", fieldPath: "safe", display: { type: ValueType.URL, link: {} } },
        ],
      },
    } } });
    const decoded = fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, panel));
    for (const withResolver of [false, true]) {
      const root = document.createElement("div");
      await renderPanel({ wasm, root, context, descriptor: decoded, invoker: { invoke: async () => ({ items: [row] }) },
        resolveHref: withResolver ? ({ targetKind, id, row: source }) => {
          expect(source).toEqual(row);
          return targetKind === "user" ? `/users/${encodeURIComponent(id)}` : null;
        } : undefined });
      const values = [...root.querySelectorAll("dd")];
      expect(values.slice(0, 4).map((el) => el.textContent)).toEqual([row.raw, "", "a,b", "Ada"]);
      expect(values[3].title).toBe("ada@example.com");
      expect(values[4].querySelector("a")?.getAttribute("href")).toBe(row.safe);
      expect(values[4].querySelector("a")?.target).toBe("_blank");
      expect(values[5].querySelector("a")).toBeNull();
      expect(values[6].querySelector("a")?.getAttribute("href")).toBe(withResolver ? "/users/user%2F7" : undefined);
      expect(values[7].querySelector("a")).toBeNull();
      expect(values[8].querySelector("a")).toBeNull();
    }
  });
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
          return method === "List" ? { items: [{ name: "Dev", repo: "meridian", phase: "Suspended", region: "2026-03-29" }] } : {};
        },
      },
      admission: {
        mutations: ["workspace.Workspaces/Resume", "workspace.Workspaces/Delete"],
      },
    });

    expect(root.querySelector(".mer-resource-card-title")?.textContent).toBe("Dev");
    expect(root.querySelector(".mer-resource-card-subtitle")?.textContent).toBe("meridian");
    expect(root.querySelector(".mer-resource-card-meta dd")?.textContent).toBe("Mar 29, 2026");
    expect(root.querySelectorAll(".mer-resource-action")).toHaveLength(2);

    (root.querySelector(".mer-resource-action-danger") as HTMLButtonElement).click();
    expect(root.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(calls.map((call) => call.method)).toEqual(["List"]);

    const confirm = [...root.querySelectorAll('[role="alertdialog"] button')].find(
      (button) => button.textContent === "Delete",
    );
    (confirm as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.map((call) => call.method)).toEqual(["List", "Delete"]);
    expect((calls[1].request as { selected: { name: string } }).selected.name).toBe("Dev");
  });

  it("does not forward a mutation when the host leaves admission at its secure default", async () => {
    const calls: string[] = [];
    const denials: Array<{ tier: string; method: string }> = [];
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor,
      context,
      invoker: {
        invoke: async (_service, method) => {
          calls.push(method);
          return method === "List" ? { items: [{ name: "Dev", phase: "Suspended" }] } : {};
        },
      },
      admission: {
        onDenied: (denial) => denials.push({ tier: denial.tier, method: denial.method }),
      },
    });

    (root.querySelector(".mer-resource-action-danger") as HTMLButtonElement).click();
    const confirm = [...root.querySelectorAll('[role="alertdialog"] button')].find(
      (button) => button.textContent === "Delete",
    );
    (confirm as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual(["List"]);
    expect(denials).toEqual([{ tier: "mutation", method: "Delete" }]);
    expect(root.querySelector(".mer-resource-action-danger")?.getAttribute("data-error"))
      .toMatch(/admission\.mutations/);
  });

  it("applies the host read allowlist before a populate reaches the invoker", async () => {
    const calls: string[] = [];
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor,
      context,
      invoker: {
        invoke: async (_service, method) => {
          calls.push(method);
          return { items: [] };
        },
      },
      admission: { reads: ["workspace.Workspaces/Get"] },
    });

    expect(calls).toEqual([]);
    expect(root.querySelector(".meridian-uiview-meta")?.textContent)
      .toMatch(/not in the reads allowlist/);
  });
});
