// @vitest-environment jsdom

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ValueType, PrincipalDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { PanelRenderer } from "@savvifi/meridian-web-react";

import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { POPULATED_RESPONSES } from "../../../schemas/conformance/populated.js";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

describe("ResourceCardPanel (MUI)", () => {
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
