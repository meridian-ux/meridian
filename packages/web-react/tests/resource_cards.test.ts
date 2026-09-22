// @vitest-environment jsdom

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ValueType, PrincipalDisplay, TemporalDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { POPULATED_RESPONSES } from "../../../schemas/conformance/populated.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";

const invoker: RpcInvoker = { invoke: async () => ({ items: [] }) };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ResourceCardPanel (React)", () => {
  for (const [name, kit] of [["HTML", htmlKit], ["Shadcn", shadcnKit]] as const) {
    it(`${name} renders the canonical populated resource-card scenario`, async () => {
      const fixture = FIXTURES.find((candidate) => candidate.shape === "resource_cards")!;
      const descriptor = fromBinary(
        PanelDescriptorSchema,
        toBinary(PanelDescriptorSchema, fixture.descriptor),
      );
      const container = document.createElement("div");
      const root = createRoot(container);
      await act(async () => root.render(createElement(MeridianProvider, {
        invoker: { invoke: async () => POPULATED_RESPONSES.resource_cards },
        kit,
        adhoc: {},
      }, createElement(PanelRenderer, { descriptor }))));
      expect(container.querySelectorAll(".mer-resource-card")).toHaveLength(2);
      expect(container.textContent).toContain("GitHub");
      expect(container.textContent).toContain("Source control");
      expect(container.textContent).toContain("PagerDuty");
      expect(container.textContent).toContain("Incident response");
      await act(async () => root.unmount());
    });
  }

  it("dispatches the resource-card shape through the kit", async () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "workspaces",
      title: "Workspaces",
      body: {
        case: "resourceCards",
        value: {
          populate: { service: "workspace.Workspaces", method: "List" },
          template: { titleField: "name" },
          emptyMessage: "No workspaces.",
        },
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          MeridianProvider,
          { invoker, kit: htmlKit, adhoc: {} },
          createElement(PanelRenderer, { descriptor }),
        ),
      );
    });
    expect(container.querySelector(".mer-resource-cards")).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("applies a declared display to fetched metadata", async () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "typed-workspaces",
      title: "Typed workspaces",
      body: {
        case: "resourceCards",
        value: {
          populate: { service: "workspace.Workspaces", method: "List" },
          rowsField: "items",
          template: {
            titleField: "name",
            meta: [{ label: "Created", fieldPath: "created", display: { type: ValueType.DATE } }],
          },
        },
      },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          MeridianProvider,
          { invoker: { invoke: async () => ({ items: [{ name: "Dev", created: "2026-03-29" }] }) }, kit: htmlKit, adhoc: {} },
          createElement(PanelRenderer, { descriptor }),
        ),
      );
    });
    expect(container.querySelector(".mer-resource-card-meta dd")?.textContent).toBe("Mar 29, 2026");
    await act(async () => root.unmount());
  });

  for (const [name, kit] of [["HTML", htmlKit], ["Shadcn", shadcnKit]] as const) {
    it(`${name} preserves raw metadata/actions and honors formatted titles and link precedence`, async () => {
      const row = { created: "2026-03-29", tags: ["a", "b"], missing: null, enabled: false,
        owner: "Ada <ada@example.com>", safe: "https://example.com", unsafe: "javascript:alert(1)", id: "user/7" };
      const descriptor = create(PanelDescriptorSchema, { panelId: "metadata", body: { case: "resourceCards", value: {
        populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
          titleField: "id", meta: [
            { label: "Raw", fieldPath: "created" }, { label: "Tags", fieldPath: "tags" }, { label: "Missing", fieldPath: "missing" },
            { label: "Enabled", fieldPath: "enabled", display: { type: ValueType.BOOLEAN } },
            { label: "Owner", fieldPath: "owner", display: { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
            { label: "Relative", fieldPath: "created", display: { type: ValueType.DATE, options: { case: "temporal", value: { display: TemporalDisplay.RELATIVE_WITH_ABSOLUTE_TITLE } } } },
            { label: "Safe", fieldPath: "safe", display: { type: ValueType.URL } },
            { label: "Unsafe", fieldPath: "unsafe", display: { type: ValueType.URL } },
            { label: "Record", fieldPath: "id", display: { type: ValueType.IDENTIFIER, link: { targetKind: "user" } } },
            { label: "Declined", fieldPath: "safe", display: { type: ValueType.URL, link: { targetKind: "declined" } } },
            { label: "Empty", fieldPath: "safe", display: { type: ValueType.URL, link: {} } },
          ], actions: { actions: [{ id: "run", label: "Run", invoke: { service: "demo.Items", method: "Run", bindings: [{ requestField: "created", source: { case: "rowField", value: "created" } }] } }] },
        },
      } } });
      const decoded = fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, descriptor));
      const calls: object[] = [];
      const container = document.createElement("div");
      const root = createRoot(container);
      await act(async () => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, admission: { mutations: ["demo.Items/Run"] },
        resolveHref: (kind, id) => kind === "user" ? `/users/${encodeURIComponent(id)}` : undefined,
        invoker: { invoke: async (_service, method, request) => { if (method === "Run") calls.push(request); return { items: [row] }; } },
      }, createElement(PanelRenderer, { descriptor: decoded }))));
      const values = [...container.querySelectorAll("dd")];
      expect(values.slice(0, 5).map((el) => el.textContent)).toEqual(["2026-03-29", "a,b", "", "No", "Ada"]);
      expect(values[4].title).toBe("ada@example.com");
      expect(values[5].title).toBe("Mar 29, 2026");
      expect(values[5].textContent).not.toBe("Mar 29, 2026");
      expect(values[6].querySelector("a")?.getAttribute("href")).toBe(row.safe);
      expect(values[6].querySelector("a")?.target).toBe("_blank");
      expect(values[7].querySelector("a")).toBeNull();
      expect(values[8].querySelector("a")?.getAttribute("href")).toBe("/users/user%2F7");
      expect(values[9].querySelector("a")).toBeNull();
      expect(values[10].querySelector("a")).toBeNull();
      await act(async () => (container.querySelector(".mer-resource-action") as HTMLButtonElement).click());
      expect(calls).toEqual([{ created: row.created }]);
      await act(async () => root.unmount());
    });
  }
});
