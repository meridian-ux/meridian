// @vitest-environment jsdom

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ValueType, PrincipalDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { MeridianSelectionContext, PanelRenderer } from "@savvifi/meridian-web-react";

import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { POPULATED_RESPONSES } from "../../../schemas/conformance/populated.js";
import { MeridianMuiProvider } from "../src/provider.js";
import { MeridianResourceCards } from "../src/components/resource_cards.js";

afterEach(cleanup);

describe("ResourceCardPanel (MUI)", () => {
  it.each(["selection", "backend", "policy"])("requires fresh confirmation after committed %s replacement", async replacement => {
    const row = { id: "raw/7" };
    const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
      populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: { titleField: "id", actions: { actions: [{
        id: "delete", label: "Delete item", confirm: { title: "Delete this item?", confirmLabel: "Confirm delete", destructive: true },
        invoke: { service: "demo.Items", method: "Delete", bindings: [
          { requestField: "id", source: { case: "rowField", value: "id" } },
          { requestField: "tenant", source: { case: "selectionKey", value: "tenant" } },
        ] },
      }] } },
    } } });
    if (descriptor.body.case !== "resourceCards") throw new Error("invalid test fixture");
    const panel = descriptor.body.value;
    const mutations: Array<{ backend: string; request: object }> = [];
    const backends = ["before", "after"].map(backend => ({ invoke: async (_s: string, _m: string, request: object) => {
      mutations.push({ backend, request }); return {};
    } }));
    const read: RpcInvoker = { invoke: async () => ({ items: [row] }) };
    const policies = [{ mutations: ["demo.Items/Delete"] }, { mutations: ["*"] }];
    const selections = [{ tenant: "before" }, { tenant: "after" }];
    const set = () => {};
    const frame = (changed: boolean, cosmetic = "original") => <MeridianMuiProvider
      invoker={backends[changed && replacement === "backend" ? 1 : 0]}
      admission={policies[changed && replacement === "policy" ? 1 : 0]}>
      <span>{cosmetic}</span>
      <MeridianSelectionContext.Provider value={{ values: selections[changed && replacement === "selection" ? 1 : 0], set }}>
        <MeridianResourceCards panel={panel} invoker={read} />
      </MeridianSelectionContext.Provider>
    </MeridianMuiProvider>;
    const mounted = render(frame(false));
    fireEvent.click(await screen.findByRole("button", { name: "Delete item" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    mounted.rerender(frame(false, "cosmetic rerender"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    mounted.rerender(frame(true));
    // Exercise the unsafe pre-fix path if it remains mounted: old confirmation
    // must not authorize a request under replacement bindings or capabilities.
    if (screen.queryByRole("alertdialog")) fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(mutations).toEqual([]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    mounted.rerender(frame(false));
    expect(screen.queryByRole("alertdialog"), "returning to old values must not revive confirmation").toBeNull();
    mounted.rerender(frame(true));
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(mutations).toEqual([{ backend: replacement === "backend" ? "after" : "before",
      request: { id: row.id, tenant: replacement === "selection" ? "after" : "before" } }]));
  });

  it("resolves nested card bindings from raw rows and live selection without mutating source data", async () => {
    const row = { id: "row", data: { zero: 0, no: false, raw: "001.20" } };
    const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
      populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: { titleField: "id", actions: { actions: [{
        id: "run", label: "Run", invoke: { service: "demo.Items", method: "Run", bindings: [
          { requestField: "payload", source: { case: "rowField", value: "data" } },
          { requestField: "payload.extra.scope", source: { case: "selectionKey", value: "tenant" } },
          { requestField: "nested", source: { case: "nested", value: { fields: [{ requestField: "empty", source: { case: "literal", value: "" } }] } } },
        ] },
      }] } },
    } } });
    let sent: unknown;
    render(<MeridianMuiProvider admission={{ mutations: ["demo.Items/Run"] }} invoker={{ invoke: async (_s, method, request) => {
      if (method === "List") return { items: [row] };
      sent = request; return {};
    } }}><MeridianSelectionContext.Provider value={{ values: { tenant: "live" }, set: () => {} }}>
      <PanelRenderer descriptor={descriptor} />
    </MeridianSelectionContext.Provider></MeridianMuiProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(sent).toEqual({ payload: { zero: 0, no: false, raw: "001.20", extra: { scope: "live" } }, nested: { empty: "" } }));
    expect(row).toEqual({ id: "row", data: { zero: 0, no: false, raw: "001.20" } });
  });

  it.each(["unsafe", "large", "cycle"])("rejects %s card bindings as a whole request", async mode => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
      populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: { titleField: "id", actions: { actions: [{
        id: "run", label: "Run", invoke: { service: "demo.Items", method: "Run", bindings: [
          { requestField: "valid", source: { case: "literal", value: "must not dispatch alone" } },
          { requestField: mode === "unsafe" ? "__proto__.scope" : "payload", source: { case: "rowField", value: "payload" } },
        ] },
      }] } },
    } } });
    const mutations: object[] = [];
    render(<MeridianMuiProvider admission={{ mutations: ["demo.Items/Run"] }} invoker={{ invoke: async (_s, method, request) => {
      if (method === "List") return { items: [{ id: "row", payload: mode === "cycle" ? cyclic : "x".repeat(800_000) }] };
      mutations.push(request); return {};
    } }}><PanelRenderer descriptor={descriptor} /></MeridianMuiProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Request construction rejected");
    expect(mutations).toEqual([]);
  });

  it.each([false, true])("reports resource mutation feedback (admitted=%s)", async (admitted) => {
    let mutations = 0;
    let denials = 0;
    const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
      populate: { service: "demo.Items", method: "List" }, rowsField: "items",
      template: { titleField: "id", actions: { actions: [{ id: "run", label: "Run", invoke: {
        service: "demo.Items", method: "Run", bindings: [{ requestField: "id", source: { case: "rowField", value: "id" } }],
      } }] } },
    } } });
    render(<MeridianMuiProvider admission={{ mutations: admitted ? ["*"] : [], onDenied: () => { denials++; } }} invoker={{ invoke: async (_, method, request) => {
      if (method === "List") return { items: [{ id: "raw/7" }] };
      expect(request).toEqual({ id: "raw/7" });
      if (++mutations === 1) throw new Error("Try again");
      return {};
    } }}><PanelRenderer descriptor={descriptor} /></MeridianMuiProvider>);
    const button = await screen.findByRole("button", { name: "Run" });
    expect(button.getAttribute("aria-disabled")).toBe(String(!admitted));
    fireEvent.click(button);
    await screen.findByRole("alert");
    if (admitted) {
      expect(screen.getByRole("alert").textContent).toContain("Try again");
      fireEvent.click(button);
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(mutations).toBe(2);
    } else { expect(mutations).toBe(0); expect(denials).toBe(1); }
  });
  it("applies declared displays to resource-card title slots", async () => {
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
    render(
      <MeridianMuiProvider
        invoker={{ invoke: async () => ({ items: [{ created: "2026-03-29", owner: "Ada <ada@example.com>" }] }) }}
      >
        <PanelRenderer descriptor={descriptor} />
      </MeridianMuiProvider>,
    );
    expect(await screen.findAllByText("Mar 29, 2026")).toHaveLength(2);
    expect(screen.getByText("Ada").getAttribute("title")).toBe("ada@example.com");
    expect(screen.getAllByText("Mar 29, 2026")).toHaveLength(2);
  });

  it("renders the canonical populated resource-card scenario", async () => {
    const fixture = FIXTURES.find((candidate) => candidate.shape === "resource_cards")!;
    const descriptor = fromBinary(
      PanelDescriptorSchema,
      toBinary(PanelDescriptorSchema, fixture.descriptor),
    );
    render(
      <MeridianMuiProvider
        invoker={{ invoke: async () => POPULATED_RESPONSES.resource_cards }}
      >
        <PanelRenderer descriptor={descriptor} />
      </MeridianMuiProvider>,
    );
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Source control")).toBeTruthy();
    expect(screen.getByText("PagerDuty")).toBeTruthy();
    expect(screen.getByText("Incident response")).toBeTruthy();
    expect(document.querySelectorAll(".MuiCard-root")).toHaveLength(2);
  });

  it("preserves raw metadata and action IDs while resolving declared links", async () => {
    const row = { created: "2026-03-29", owner: "Ada <ada@example.com>", id: "user/7", url: "https://example.com", unsafe: "javascript:bad()" };
    const descriptor = create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
      populate: { service: "demo.Items", method: "List" }, rowsField: "items", template: {
        titleField: "id", meta: [
          { label: "Raw", fieldPath: "created" },
          { label: "Owner", fieldPath: "owner", display: { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
          { label: "Record", fieldPath: "id", display: { type: ValueType.IDENTIFIER, link: { targetKind: "user" } } },
          { label: "Direct", fieldPath: "url", display: { type: ValueType.URL } },
          { label: "Unsafe", fieldPath: "unsafe", display: { type: ValueType.URL } },
          { label: "Declined", fieldPath: "url", display: { type: ValueType.URL, link: { targetKind: "declined" } } },
        ], actions: { actions: [{ id: "run", label: "Run", invoke: { service: "demo.Items", method: "Run", bindings: [{ requestField: "id", source: { case: "rowField", value: "id" } }] } }] },
      },
    } } });
    const decoded = fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, descriptor));
    const calls: object[] = [];
    render(<MeridianMuiProvider invoker={{ invoke: async (_service, method, request) => {
      if (method === "Run") calls.push(request);
      return { items: [row] };
    } }} admission={{ mutations: ["demo.Items/Run"] }} resolveHref={(kind, id) => kind === "user" ? `/users/${encodeURIComponent(id)}` : undefined}>
      <PanelRenderer descriptor={decoded} />
    </MeridianMuiProvider>);
    expect(await screen.findByText(row.created)).toBeTruthy();
    expect(screen.getByText("Ada").getAttribute("title")).toBe("ada@example.com");
    expect(screen.getByRole("link", { name: row.id }).getAttribute("href")).toBe("/users/user%2F7");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: row.url }).getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(calls).toEqual([{ id: row.id }]));
  });
  it("fetches and renders resource metadata through the MUI kit", async () => {
    const invoker: RpcInvoker = {
      invoke: async (_service, method) => method === "List"
        ? { items: [{ name: "Dev", phase: "Suspended", region: "2026-03-29" }] }
        : {},
    };
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "workspaces",
      title: "Workspaces",
      body: {
        case: "resourceCards",
        value: {
          populate: { service: "workspace.Workspaces", method: "List" },
          rowsField: "items",
          template: {
            titleField: "name",
            statusField: "phase",
            meta: [{ label: "Region", fieldPath: "region", display: { type: ValueType.DATE } }],
          },
        },
      },
    });
    render(
      <MeridianMuiProvider invoker={invoker}>
        <PanelRenderer descriptor={descriptor} />
      </MeridianMuiProvider>,
    );
    expect(await screen.findByText("Dev")).toBeTruthy();
    expect(screen.getByText("Suspended")).toBeTruthy();
    expect(screen.getByText("Mar 29, 2026")).toBeTruthy();
  });
});
