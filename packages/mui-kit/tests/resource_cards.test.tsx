// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { PanelRenderer } from "@savvifi/meridian-web-react";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

describe("ResourceCardPanel (MUI)", () => {
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
