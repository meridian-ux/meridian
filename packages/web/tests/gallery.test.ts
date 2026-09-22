// @vitest-environment jsdom

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { PrincipalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { POPULATED_RESPONSES } from "../../../schemas/conformance/populated.js";
import { formatByDisplay } from "@savvifi/meridian-schemas/uiview";

const wasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: () => ({}),
  renderTablePanel: () => [] as RenderedRow[],
  formatLroMetadata: () => "",
};

it("renders canonical populated table rows and admits only host-resolved member links", async () => {
  const fixture = FIXTURES.find((candidate) => candidate.shape === "table")!;
  const root = document.createElement("div");
  // This suite tests the DOM bridge. Native TestBackend tests separately exercise
  // the actual Rust formatter with the same serialized descriptor and row values.
  const bridge: UiviewWasm = { ...wasm, renderTable: (bytes, response) => {
    const descriptor = fromBinary(PanelDescriptorSchema, bytes);
    if (descriptor.body.case !== "table") throw new Error("expected table");
    const table = descriptor.body.value;
    const rows = (response as Record<string, Array<Record<string, unknown>>>)[table.rowsField];
    return rows.map((raw) => ({ raw, cells: table.columns.map((column) => column.valueDisplay
      ? formatByDisplay(raw[column.fieldPath], column.valueDisplay).text
      : String(raw[column.fieldPath] ?? "")) }));
  } };
  await renderPanel({ wasm: bridge, root,
    descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, fixture.descriptor)),
    invoker: { invoke: async () => POPULATED_RESPONSES.table },
    context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    resolveHref: ({ targetKind, id }) => targetKind === "member" && id === "Ada" ? "/members/ada" : undefined,
  });
  expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
  for (const text of ["Ada", "Grace", "0012.50", "0007.00", "Yes", "No", "javascript:alert(1)"]) expect(root.textContent).toContain(text);
  expect([...root.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
    "/members/ada",
    "https://example.com/ada",
  ]);
  expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
});

it("routes declared table value links by their raw value and suppresses URL fallback", async () => {
  const created = "2026-03-29";
  const website = "https://example.com/docs";
  const descriptor = create(PanelDescriptorSchema, {
    panelId: "linked-values",
    body: {
      case: "table",
      value: create(TablePanelSchema, {
        populate: { service: "demo.Builds", method: "List" },
        rowsField: "items",
        columns: [
          { header: "Created", fieldPath: "created", valueDisplay: { type: ValueType.DATE, link: { targetKind: "build" } } },
          { header: "Website", fieldPath: "website", valueDisplay: { type: ValueType.URL, link: { targetKind: "document" } } },
        ],
      }),
    },
  });
  const raw = { created, website };
  const bridge: UiviewWasm = {
    ...wasm,
    renderTable: () => [{ raw, cells: ["Mar 29, 2026", website] }],
  };
  const resolved: Array<[string, string]> = [];
  const root = document.createElement("div");
  await renderPanel({
    wasm: bridge,
    root,
    descriptor,
    invoker: { invoke: async () => ({ items: [raw] }) },
    context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    resolveHref: ({ targetKind, id }) => {
      resolved.push([targetKind, id]);
      return targetKind === "build" ? `/builds/${id}` : undefined;
    },
  });
  expect(root.querySelector("a")?.getAttribute("href")).toBe("/builds/2026-03-29");
  expect(root.querySelector("a")?.textContent).toBe("Mar 29, 2026");
  expect(root.querySelectorAll("a")).toHaveLength(1);
  expect(root.textContent).toContain(website);
  expect(resolved).toEqual([["build", created], ["document", website]]);
});

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

  it("renders the canonical populated gallery descriptor", async () => {
    const root = document.createElement("div");
    const fixture = FIXTURES.find((candidate) => candidate.shape === "gallery")!;
    await renderPanel({
      wasm,
      root,
      descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, fixture.descriptor)),
      invoker: { invoke: async () => POPULATED_RESPONSES.gallery },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });
    expect(root.querySelectorAll(".mer-gallery-card")).toHaveLength(2);
    expect(root.textContent).toContain("GitHub");
    expect(root.textContent).toContain("PagerDuty");
    expect(root.querySelectorAll(".mer-gallery-card-link")).toHaveLength(2);
  });
});
