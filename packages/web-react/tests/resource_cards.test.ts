// @vitest-environment jsdom

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createElement, startTransition, Suspense, useState } from "react";
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
    it(`${name} keeps a committed card action live while a replacement render suspends`, async () => {
      const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
        populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: { titleField: "id", actions: { actions: [{
          id: "run", label: "Run", invoke: { service: "demo.Items", method: "Run" },
        }] } },
      } } });
      let replace!: () => void;
      let finish!: (value: object) => void;
      let suspended = false;
      const never = new Promise<void>(() => {});
      const old: RpcInvoker = { invoke: (_s, method) => method === "List" ? Promise.resolve({ items: [{ id: "One" }] })
        : new Promise(resolve => { finish = resolve; }) };
      const next: RpcInvoker = { invoke: async () => ({ items: [] }) };
      function Hold({ replacement }: { replacement: boolean }) {
        if (replacement) { suspended = true; throw never; }
        return null;
      }
      function App() {
        const [replacement, setReplacement] = useState(false);
        replace = () => setReplacement(true);
        return createElement(Suspense, { fallback: createElement("p", null, "Replacement loading") },
          createElement(MeridianProvider, { kit, adhoc: {}, invoker: replacement ? next : old, admission: { mutations: ["demo.Items/Run"] } },
            createElement(PanelRenderer, { descriptor }), createElement(Hold, { replacement })));
      }
      const container = document.createElement("div"); const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(App)));
        await act(async () => container.querySelector<HTMLButtonElement>(".mer-resource-action")!.click());
        await act(async () => startTransition(replace));
        expect(suspended).toBe(true);
        expect(container.textContent).not.toContain("Replacement loading");
        await act(async () => finish({}));
        expect(container.querySelector<HTMLButtonElement>(".mer-resource-action")!.disabled).toBe(false);
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      } finally { await act(async () => root.unmount()); }
    });

    it.each(["unsafe", "large", "cycle"])(`${name} rejects %s action requests before dispatch`, async mode => {
      const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
        populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
          titleField: "name", actions: { actions: [{ id: "run", label: "Run", invoke: {
            service: "demo.Items", method: "Run", bindings: [
              { requestField: "valid", source: { case: "literal", value: "must not dispatch alone" } },
              { requestField: mode === "unsafe" ? "__proto__.scope" : "payload", source: { case: "rowField", value: "payload" } },
            ],
          } }] },
        },
      } } });
      const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
      const calls: string[] = [];
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(MeridianProvider, {
          kit, adhoc: {}, admission: { mutations: ["demo.Items/Run"] }, invoker: { invoke: async (_service, method) => {
            calls.push(method);
            return { items: [{ name: "One", payload: mode === "cycle" ? cyclic : "x".repeat(800_000) }] };
          } },
        }, createElement(PanelRenderer, { descriptor }))));
        await act(async () => container.querySelector<HTMLButtonElement>(".mer-resource-action")!.click());
        expect(calls).toEqual(["List"]);
        expect(container.querySelector('[role="alert"]')?.textContent).toBe("Action failed. Try again.");
      } finally { await act(async () => root.unmount()); }
    });

    it(`${name} reports synchronous populate failures`, async () => {
      const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
        populate: { service: "demo.Items", method: "List" }, template: { titleField: "name" },
      } } });
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(MeridianProvider, {
          kit, adhoc: {}, invoker: { invoke: () => { throw new Error("private transport detail"); } },
        }, createElement(PanelRenderer, { descriptor }))));
        expect(container.textContent).toContain("Failed to load resources.");
        expect(container.textContent).not.toContain("private transport detail");
      } finally { await act(async () => root.unmount()); }
    });

    for (const synchronous of [true, false]) {
      it(`${name} reports ${synchronous ? "synchronous" : "asynchronous"} action failures and allows retry`, async () => {
        const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
          populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
            titleField: "name", actions: { actions: [{ id: "run", label: "Run", invoke: {
              service: "demo.Items", method: "Run", bindings: [{ requestField: "id", source: { case: "rowField", value: "id" } }],
            } }] },
          },
        } } });
        let attempts = 0;
        const container = document.createElement("div");
        const root = createRoot(container);
        const requests: object[] = [];
        try {
          await act(async () => root.render(createElement(MeridianProvider, {
            kit, adhoc: {}, admission: { mutations: ["demo.Items/Run"] }, invoker: { invoke: (_service, method, request) => {
              if (method !== "Run") return Promise.resolve({ items: [{ id: 0, name: "Zero" }] });
              requests.push(request);
              if (++attempts === 1) {
                if (synchronous) throw new Error("private action detail");
                return Promise.reject(new Error("private action detail"));
              }
              return Promise.resolve({});
            } },
          }, createElement(PanelRenderer, { descriptor }))));
          const button = container.querySelector(".mer-resource-action") as HTMLButtonElement;
          await act(async () => button.click());
          const alert = container.querySelector('[role="alert"]');
          expect(alert?.textContent).toBe("Action failed. Try again.");
          expect(button.getAttribute("aria-describedby")).toBe(alert?.id);
          expect(button.disabled).toBe(false);
          expect(container.textContent).not.toContain("private action detail");
          await act(async () => button.click());
          expect(attempts).toBe(2);
          expect(requests).toEqual([{ id: 0 }, { id: 0 }]);
          expect(container.querySelector('[role="alert"]')).toBeNull();
        } finally { await act(async () => root.unmount()); }
      });
    }

    it(`${name} preserves explicit confirmation before dispatch and reports its failure`, async () => {
      const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
        populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
          titleField: "name", actions: { actions: [{ id: "run", label: "Run", confirm: { title: "Run it?", confirmLabel: "Proceed" },
            invoke: { service: "demo.Items", method: "Run" } }] },
        },
      } } });
      let calls = 0;
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(MeridianProvider, {
          kit, adhoc: {}, admission: { mutations: ["demo.Items/Run"] }, invoker: { invoke: async (_service, method) => {
            if (method === "Run") { calls++; throw new Error("rejected"); }
            return { items: [{ name: "One" }] };
          } },
        }, createElement(PanelRenderer, { descriptor }))));
        const button = container.querySelector(".mer-resource-action") as HTMLButtonElement;
        await act(async () => button.click());
        expect(calls).toBe(0);
        expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain("Run it?");
        const controls = container.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button');
        await act(async () => controls[1].click());
        expect(calls).toBe(0);
        expect(container.querySelector('[role="alertdialog"]')).toBeNull();
        await act(async () => button.click());
        await act(async () => container.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
        expect(calls).toBe(1);
        expect(container.querySelector('[role="alertdialog"]')).toBeNull();
        expect(container.querySelector('[role="alert"]')?.textContent).toBe("Action failed. Try again.");
      } finally { await act(async () => root.unmount()); }
    });

    it(`${name} contains request-construction failure without invoking or losing retry`, async () => {
      const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
        populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
          titleField: "name", actions: { actions: [{ id: "run", label: "Run", invoke: {
            service: "demo.Items", method: "Run", bindings: [{ requestField: "id", source: { case: "rowField", value: "id" } }],
          } }] },
        },
      } } });
      if (descriptor.body.case !== "resourceCards") throw new Error("Wrong fixture arm");
      const binding = descriptor.body.value.template!.actions!.actions[0].invoke!.bindings[0];
      let rejectConstruction = true;
      Object.defineProperty(binding, "requestField", { get: () => {
        if (rejectConstruction) throw new Error("request construction rejected");
        return "id";
      } });
      let calls = 0;
      const container = document.createElement("div");
      const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(MeridianProvider, {
          kit, adhoc: {}, admission: { mutations: ["demo.Items/Run"] }, invoker: { invoke: async (_service, method) => {
            if (method === "Run") { calls++; return {}; }
            return { items: [{ id: false, name: "False" }] };
          } },
        }, createElement(PanelRenderer, { descriptor }))));
        const button = container.querySelector(".mer-resource-action") as HTMLButtonElement;
        await act(async () => button.click());
        expect(calls).toBe(0);
        expect(container.querySelector('[role="alert"]')?.textContent).toBe("Action failed. Try again.");
        rejectConstruction = false;
        await act(async () => button.click());
        expect(calls).toBe(1);
        expect(container.querySelector('[role="alert"]')).toBeNull();
      } finally { await act(async () => root.unmount()); }
    });

    it(`${name} suppresses duplicate actions and ignores a replaced transport's late failure`, async () => {
      const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
        populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
          titleField: "name", actions: { actions: [{ id: "run", label: "Run", invoke: { service: "demo.Items", method: "Run" } }] },
        },
      } } });
      let rejectOld!: (reason: Error) => void;
      const oldRequest = new Promise((_, reject) => { rejectOld = reject; });
      let attempts = 0;
      const oldInvoker: RpcInvoker = { invoke: (_service, method) => method === "Run"
        ? (++attempts, oldRequest) : Promise.resolve({ items: [{ name: "Old" }] }) };
      const newInvoker: RpcInvoker = { invoke: async () => ({ items: [{ name: "New" }] }) };
      const container = document.createElement("div");
      const root = createRoot(container);
      const render = (transport: RpcInvoker) => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, admission: { mutations: ["demo.Items/Run"] }, invoker: transport,
      }, createElement(PanelRenderer, { descriptor })));
      try {
        await act(async () => render(oldInvoker));
        const button = container.querySelector(".mer-resource-action") as HTMLButtonElement;
        await act(async () => { button.click(); button.click(); });
        expect(attempts).toBe(1);
        expect(button.disabled).toBe(true);
        expect(button.getAttribute("aria-busy")).toBe("true");
        await act(async () => render(newInvoker));
        expect(container.textContent).toContain("New");
        await act(async () => rejectOld(new Error("late old failure")));
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect((container.querySelector(".mer-resource-action") as HTMLButtonElement).disabled).toBe(false);
      } finally { await act(async () => root.unmount()); }
    });

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

    it(`${name} applies declared displays to resource-card title slots`, async () => {
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "typed-slots",
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
      const container = document.createElement("div");
      const root = createRoot(container);
      await act(async () => root.render(createElement(MeridianProvider, {
        invoker: { invoke: async () => ({ items: [{ created: "2026-03-29", owner: "Ada <ada@example.com>" }] }) },
        kit,
        adhoc: {},
      }, createElement(PanelRenderer, { descriptor }))));
      expect(container.querySelector(".mer-resource-card-title")?.textContent).toBe("Mar 29, 2026");
      expect(container.querySelector(".mer-resource-card-subtitle")?.textContent).toBe("Ada");
      expect(container.querySelector(".mer-resource-card-subtitle")?.getAttribute("title")).toBe("ada@example.com");
      expect(container.querySelector(".mer-resource-card-status")?.textContent).toBe("Mar 29, 2026");
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
