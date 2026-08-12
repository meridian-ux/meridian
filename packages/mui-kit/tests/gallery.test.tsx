// MeridianGallery round-trip: a GalleryPanel with an image_field renders the
// lightbox (stage img + caption + status + filmstrip + counter), asset URLs are
// host-resolved (resolveAssetSrc), and a GalleryPanel WITHOUT an image_field
// degrades to a card grid.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { CardSpecSchema, GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { type ViewDescriptor, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { ViewRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

const invoker: RpcInvoker = {
  invoke: async (_service, method) => {
    if (method === "get-run") {
      return {
        slides: [
          { uri: "/evidence/a.png", caption: "open the app root", status: "PASSED" },
          { uri: "/evidence/b.png", caption: "assert visible", status: "FAILED" },
        ],
      };
    }
    return {};
  },
};

function galleryView(withImage: boolean): ViewDescriptor {
  return create(ViewDescriptorSchema, {
    id: "run", title: "Run", route: "/run/:name", subjectKind: "TestRun", kind: ViewKind.DETAIL,
    layout: { mode: { case: "list", value: {} } },
    slots: [{
      id: "replay", role: "content", position: 0,
      panel: create(PanelDescriptorSchema, {
        panelId: "replay", title: "Replay",
        body: {
          case: "gallery",
          value: create(GalleryPanelSchema, {
            rowsField: "slides",
            placeholder: "No screenshots.",
            populate: create(RpcCallSchema, { service: "demo.runs.v1.RunService", method: "get-run" }),
            card: create(CardSpecSchema, {
              titleField: "caption",
              statusField: "status",
              ...(withImage ? { imageField: "uri" } : {}),
            }),
          }),
        },
      }),
    }],
  });
}

describe("MeridianGallery", () => {
  it("renders the image lightbox with host-resolved asset URLs", async () => {
    const { container } = render(
      <MeridianMuiProvider invoker={invoker} resolveAssetSrc={(s) => `/tools/e2e${s}`}>
        <ViewRenderer view={galleryView(true)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("open the app root"); // wait for the fetch → render
    // stage (alt=caption) + filmstrip thumbs (alt="") all use the resolved src.
    const srcs = Array.from(container.querySelectorAll("img")).map((el) => el.getAttribute("src"));
    expect(srcs).toContain("/tools/e2e/evidence/a.png");
    expect(srcs).toContain("/tools/e2e/evidence/b.png"); // filmstrip thumb
    await screen.findByText("open the app root"); // caption
    await screen.findByText("PASSED"); // status chip
    await screen.findByText("1 / 2"); // counter
    await screen.findByText("Next ›"); // control
  });

  it("degrades to a card grid when there is no image_field", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={galleryView(false)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("open the app root");
    await screen.findByText("assert visible");
    expect(screen.queryAllByRole("img")).toHaveLength(0); // no images without image_field
  });
});
