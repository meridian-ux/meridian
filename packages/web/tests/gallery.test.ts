// @vitest-environment jsdom

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PrincipalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
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
  it.each([false, true])("fetches wire-decoded cards with declared displays=%s", async (declared) => {
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, create(PanelDescriptorSchema, {
        title: "Integrations",
        body: {
          case: "gallery",
          value: create(GalleryPanelSchema, {
            populate: { service: "demo.Catalog", method: "List" },
            rowsField: "items",
            card: {
              titleField: "created",
              titleDisplay: declared ? { type: ValueType.DATE } : undefined,
              subtitleField: "description",
              subtitleDisplay: declared ? { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } : undefined,
              iconField: "icon",
              statusField: "status",
              statusDisplay: declared ? { type: ValueType.BOOLEAN } : undefined,
              hrefField: "href",
              actionLabelField: "action",
              imageField: "image",
            },
          }),
        },
      }))),
      invoker: {
        invoke: async () => ({
          items: [{
            name: "GitHub",
            created: "2026-03-29",
            description: "Ada <ada@example.com>",
            icon: "github",
            status: false,
            href: "https://github.com",
            action: "Manage",
            image: "github.png",
          }],
        }),
      },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });
    expect(root.querySelector(".mer-gallery-card-title")?.textContent).toBe(declared ? "Mar 29, 2026" : "2026-03-29");
    expect(root.querySelector(".mer-gallery-card-subtitle")?.textContent).toBe(declared ? "Ada" : "Ada <ada@example.com>");
    expect(root.querySelector(".mer-gallery-card-subtitle")?.getAttribute("title")).toBe(declared ? "ada@example.com" : null);
    expect(root.querySelector(".mer-gallery-card-status")?.textContent).toBe(declared ? "No" : "false");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://github.com");
    expect(root.querySelector("img")?.getAttribute("src")).toBe("github.png");
    expect(root.querySelector("img")?.getAttribute("alt")).toBe(declared ? "Mar 29, 2026" : "2026-03-29");
    expect(root.querySelectorAll("a")).toHaveLength(1);
    expect(root.textContent).toContain("Manage");
  });
});
