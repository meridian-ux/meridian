// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";

const wasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: () => ({}),
  renderTablePanel: () => [] as RenderedRow[],
  formatLroMetadata: () => "",
};

describe("web-components GalleryPanel", () => {
  it("fetches rows and renders card metadata and navigation", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor: create(PanelDescriptorSchema, {
        title: "Integrations",
        body: {
          case: "gallery",
          value: create(GalleryPanelSchema, {
            populate: { service: "demo.Catalog", method: "List" },
            rowsField: "items",
            card: {
              titleField: "name",
              subtitleField: "description",
              iconField: "icon",
              statusField: "status",
              hrefField: "href",
              actionLabelField: "action",
              imageField: "image",
            },
          }),
        },
      }),
      invoker: {
        invoke: async () => ({
          items: [{
            name: "GitHub",
            description: "Source control",
            icon: "github",
            status: "Connected",
            href: "https://github.com",
            action: "Manage",
            image: "github.png",
          }],
        }),
      },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });
    expect(root.querySelector(".mer-gallery-card-title")?.textContent).toBe("GitHub");
    expect(root.textContent).toContain("Source control");
    expect(root.textContent).toContain("Connected");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://github.com");
    expect(root.querySelector("img")?.getAttribute("src")).toBe("github.png");
    expect(root.textContent).toContain("Manage");
  });
});
