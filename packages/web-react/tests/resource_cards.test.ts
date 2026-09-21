// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";

const invoker: RpcInvoker = { invoke: async () => ({ items: [] }) };

describe("ResourceCardPanel (React)", () => {
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
    root.unmount();
  });
});
