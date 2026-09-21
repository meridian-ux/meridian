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
import { StreamPanelSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { MediaKind, MediaPanelSchema } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { DetailHeaderPanelSchema, RecordCardPanelSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider } from "../src/provider.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

function render(descriptor: PanelDescriptor, kit = htmlKit): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit, adhoc: {} },
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

  it("renders a StreamPanel through htmlKit with an accessible placeholder", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "build-log",
      title: "Build log",
      body: {
        case: "stream",
        value: create(StreamPanelSchema, {
          placeholder: "Waiting for build events...",
          itemNoun: "events",
        }),
      },
    });
    const html = render(descriptor);
    expect(html).toContain('class="mer-stream"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Waiting for build events...");
  });

  it("renders detail header and record card semantics through htmlKit", () => {
    const header = render(create(PanelDescriptorSchema, {
      panelId: "header",
      body: { case: "detailHeader", value: create(DetailHeaderPanelSchema, {
        title: "Sponsor", subtitleSourcePath: "data.owner", statusSourcePath: "data.status",
        descriptorRows: [{ label: "Type", sourcePath: "data.type" }],
      }) },
    }));
    expect(header).toContain("Sponsor");
    expect(header).toContain("data.owner");
    expect(header).toContain("data.status");
    expect(header).toContain("data.type");

    const card = render(create(PanelDescriptorSchema, {
      panelId: "card",
      body: { case: "recordCard", value: create(RecordCardPanelSchema, {
        itemNoun: "sponsor", fields: [{ fieldId: "name", label: "Name" }],
      }) },
    }));
    expect(card).toContain('aria-label="sponsor"');
    expect(card).toContain("Name");
    expect(card).toContain("name");
  });

  it("renders shadcn detail headers through the same dispatch seam", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "header",
      body: { case: "detailHeader", value: create(DetailHeaderPanelSchema, {
        title: "Profile", descriptorRows: [{ label: "Type", sourcePath: "data.type" }],
      }) },
    }), shadcnKit);
    expect(html).toContain("Profile");
    expect(html).toContain("Record summary");
    expect(html).toContain("data.type");
  });

  it("renders HTML media with poster, captions, and accessible text", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "demo-video",
      body: { case: "media", value: create(MediaPanelSchema, {
        kind: MediaKind.VIDEO,
        srcUri: "/demo.mp4",
        posterUri: "/poster.jpg",
        captionsUri: "/demo.vtt",
        alt: "A demo walkthrough",
        caption: "Product demo",
      }) },
    }));
    expect(html).toContain('class="mer-media"');
    expect(html).toContain('poster="/poster.jpg"');
    expect(html).toContain('src="/demo.vtt"');
    expect(html).toContain("Product demo");
  });
});
