// MeridianGallery round-trip: a GalleryPanel with an image_field renders the
// lightbox (stage img + caption + status + filmstrip + counter), asset URLs are
// host-resolved (resolveAssetSrc), and a GalleryPanel WITHOUT an image_field
// degrades to a card grid.

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CardSpecSchema, GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { PrincipalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
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
          { uri: "/evidence/a.png", caption: "open the app root", created: "2026-03-29", owner: "Ada <ada@example.com>", status: true, href: "/runs/a" },
          { uri: "/evidence/b.png", caption: "assert visible", created: "2026-03-30", owner: "Grace <grace@example.com>", status: false, href: "/runs/b" },
        ],
      };
    }
    return {};
  },
};

function galleryView(withImage: boolean, declared = true): ViewDescriptor {
  return fromBinary(ViewDescriptorSchema, toBinary(ViewDescriptorSchema, create(ViewDescriptorSchema, {
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
              titleField: "created",
              titleDisplay: declared ? { type: ValueType.DATE } : undefined,
              subtitleField: "owner",
              subtitleDisplay: declared ? { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } : undefined,
              statusField: "status",
              statusDisplay: declared ? { type: ValueType.BOOLEAN } : undefined,
              hrefField: "href",
              ...(withImage ? { imageField: "uri" } : {}),
            }),
          }),
        },
      }),
    }],
  })));
}

describe("MeridianGallery", () => {
  it("renders the image lightbox with host-resolved asset URLs", async () => {
    const { container } = render(
      <MeridianMuiProvider invoker={invoker} resolveAssetSrc={(s) => `/tools/e2e${s}`}>
        <ViewRenderer view={galleryView(true)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("Mar 29, 2026"); // wait for the fetch → render
    // stage (alt=caption) + filmstrip thumbs (alt="") all use the resolved src.
    const srcs = Array.from(container.querySelectorAll("img")).map((el) => el.getAttribute("src"));
    expect(srcs).toContain("/tools/e2e/evidence/a.png");
    expect(srcs).toContain("/tools/e2e/evidence/b.png"); // filmstrip thumb
    await screen.findByText("Mar 29, 2026"); // caption/status
    await screen.findByText("Ada"); // subtitle
    expect(screen.getByText("Ada").getAttribute("title")).toBe("ada@example.com");
    expect(screen.getByRole("img", { name: "Mar 29, 2026" }).getAttribute("src")).toBe("/tools/e2e/evidence/a.png");
    expect(screen.getByText("Yes")).toBeTruthy();
    await screen.findByText("1 / 2"); // counter
    await screen.findByText("Next ›"); // control
    fireEvent.click(screen.getByText("Next ›"));
    expect(screen.getByRole("img", { name: "Mar 30, 2026" })).toBeTruthy();
    expect(screen.getByText("Grace").getAttribute("title")).toBe("grace@example.com");
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("degrades to a card grid when there is no image_field", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={galleryView(false)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("Mar 29, 2026");
    await screen.findByText("Mar 30, 2026");
    expect(screen.queryAllByRole("img")).toHaveLength(0); // no images without image_field
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/runs/a", "/runs/b"]);
    expect(screen.getByText("Ada").getAttribute("title")).toBe("ada@example.com");
  });

  it.each([false, true])("preserves legacy output without displays (images=%s)", async (withImage) => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={galleryView(withImage, false)} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("2026-03-29");
    expect(screen.getByText("true")).toBeTruthy();
    expect(screen.queryByText("Ada <ada@example.com>")).toBeNull();
    expect(screen.queryByText("Mar 29, 2026")).toBeNull();
    if (withImage) expect(screen.getByRole("img", { name: "2026-03-29" })).toBeTruthy();
  });
});
