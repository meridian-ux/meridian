// Runtime proof that the React renderer dispatches a PanelDescriptor through a
// ComponentKit. Uses react-dom/server (node env, no jsdom) + createElement (no
// JSX transpile needed). This is the React-side seed of the cross-renderer
// conformance idea: the same descriptor that the web-components renderer hosts
// renders here through htmlKit.

import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider } from "../src/provider.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

function render(descriptor: PanelDescriptor): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit: htmlKit, adhoc: {} },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}

describe("meridian-web-react renderer", () => {
  it("renders a TablePanel through htmlKit (title + column headers + placeholder)", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "claims",
      title: "Claims",
      body: {
        case: "table",
        value: create(TablePanelSchema, {
          columns: [{ header: "Member" }, { header: "Amount" }],
          placeholder: "no claims",
        }),
      },
    });
    const html = render(descriptor);
    expect(html).toContain("Claims");
    expect(html).toContain("Member");
    expect(html).toContain("Amount");
    expect(html).toContain("no claims");
  });

  it("falls back for an unset panel body", () => {
    const descriptor = create(PanelDescriptorSchema, { panelId: "x", title: "X" });
    expect(render(descriptor)).toContain("empty panel");
  });
});
