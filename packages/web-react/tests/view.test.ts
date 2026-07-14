// ViewRenderer round-trip over the two REAL studio views (products list + detail).
//
// Grounds the ViewDescriptor tier against reality: these fixtures are the
// meridian projections of savvi.studio.product's list-view.aion (ListLayout + a
// TablePanel content slot + header actions) and detail-view.aion (StackedLayout +
// a header slot + a configuration FormPanel slot). We assert the layout tier
// renders through the kits (htmlKit + shadcnKit) via ViewRenderer — the panels,
// the slots, the form fields, and the actions all appear.

import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import {
  FormMode,
  FormPanelSchema,
  PanelDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import {
  ActionPlacement,
  type ViewDescriptor,
  ViewDescriptorSchema,
  ViewKind,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import type { ComponentKit } from "../src/component_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { ViewRenderer } from "../src/view_renderer.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

// The entity-detail-header is a bespoke aion widget → an AdhocPanel in meridian;
// the host registers a handler for it (here a minimal stand-in). Without this it
// would fall back — which is also correct meridian behavior.
const adhoc = {
  "entity-detail-header": () =>
    createElement("div", { className: "mer-detail-header" }, "detail header"),
};

function renderView(kit: ComponentKit, view: ViewDescriptor): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit, adhoc },
      createElement(ViewRenderer, { view }),
    ),
  );
}

const PRODUCT_ACTIONS = ["edit", "clone", "delete", "export_yaml"].map((id) => ({
  id,
  label: id === "export_yaml" ? "Export YAML" : id[0].toUpperCase() + id.slice(1),
  placement: ActionPlacement.HEADER,
  call: create(RpcCallSchema, { service: "savvi.studio.product", method: id }),
}));

// products/views/list-view.aion  →  ListLayout + one TablePanel content slot.
const productsListView: ViewDescriptor = create(ViewDescriptorSchema, {
  id: "products-list-view",
  title: "Products",
  route: "/entities/products",
  subjectKind: "products",
  kind: ViewKind.LIST,
  layout: { mode: { case: "list", value: {} } },
  actions: PRODUCT_ACTIONS,
  slots: [
    {
      id: "content",
      role: "content",
      position: 10,
      panel: create(PanelDescriptorSchema, {
        panelId: "products-list",
        title: "Products",
        body: {
          case: "table",
          value: create(TablePanelSchema, {
            itemNoun: "product",
            rowsField: "products",
            placeholder: "No products.",
            columns: [{ header: "Name" }, { header: "Type" }, { header: "Status" }],
            populate: create(RpcCallSchema, {
              service: "savvi.studio.product",
              method: "list-products",
            }),
          }),
        },
      }),
    },
  ],
});

// products/views/detail-view.aion  →  StackedLayout + header + configuration FormPanel.
const productsDetailView: ViewDescriptor = create(ViewDescriptorSchema, {
  id: "products-detail-view",
  title: "Product Details",
  route: "/entities/products/id/:entityId",
  subjectKind: "products",
  kind: ViewKind.DETAIL,
  layout: { mode: { case: "stacked", value: {} } },
  actions: PRODUCT_ACTIONS,
  slots: [
    {
      id: "header",
      role: "header",
      position: 10,
      panel: create(PanelDescriptorSchema, {
        panelId: "products-detail-header",
        title: "Product",
        body: { case: "adhoc", value: { handlerId: "entity-detail-header" } },
      }),
    },
    {
      id: "configuration",
      role: "configuration",
      position: 30,
      title: "Product Details",
      panel: create(PanelDescriptorSchema, {
        panelId: "products-detail-configuration",
        title: "Product Configuration",
        body: {
          case: "form",
          value: create(FormPanelSchema, {
            mode: FormMode.READONLY,
            itemNoun: "product",
            fields: [
              create(FormFieldSchema, { fieldId: "type", label: "Product Type" }),
              create(FormFieldSchema, { fieldId: "status", label: "Review Status" }),
              create(FormFieldSchema, { fieldId: "data", label: "Attributes" }),
            ],
          }),
        },
      }),
    },
  ],
});

describe("ViewRenderer over the real studio views (htmlKit + shadcnKit)", () => {
  for (const kit of [htmlKit, shadcnKit]) {
    it(`renders the products LIST view via ${kit.id}`, () => {
      const html = renderView(kit, productsListView);
      expect(html).toContain("Products"); // view title
      expect(html).toContain("Name"); // table column (the panel rendered)
      expect(html).toContain("Status");
      expect(html).toContain("Edit"); // a header action
      expect(html).toContain("Export YAML");
      expect(html).not.toContain("unsupported panel shape");
    });

    it(`renders the products DETAIL view (stacked + FormPanel) via ${kit.id}`, () => {
      const html = renderView(kit, productsDetailView);
      expect(html).toContain("Product Details"); // view title + slot title
      // the FormPanel configuration slot rendered its fields:
      expect(html).toContain("Product Type");
      expect(html).toContain("Review Status");
      expect(html).toContain("Attributes");
      expect(html).toContain("Delete"); // a header action
      // the FormPanel is a real shape (not a fallback):
      expect(html).not.toContain("unsupported panel shape");
    });
  }

  it("orders stacked slots by position", () => {
    const html = renderView(htmlKit, productsDetailView);
    // header (position 10) before configuration (position 30)
    expect(html.indexOf('data-slot="header"')).toBeLessThan(
      html.indexOf('data-slot="configuration"'),
    );
  });

  // Composition: a slot may embed a whole ViewDescriptor (`sub_view`), rendered
  // recursively by ViewRenderer — kit-agnostic, so both kits nest without any
  // kit-specific code.
  it("renders a nested sub_view recursively (layout-in-a-layout)", () => {
    const nested = create(ViewDescriptorSchema, {
      id: "nested-section",
      title: "Nested Section",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "list", value: {} } },
      slots: [
        {
          id: "inner",
          role: "content",
          position: 0,
          panel: create(PanelDescriptorSchema, {
            panelId: "inner-table",
            title: "Inner",
            body: {
              case: "table",
              value: create(TablePanelSchema, {
                rowsField: "x",
                placeholder: "INNER-PLACEHOLDER",
                columns: [{ header: "C" }],
                populate: create(RpcCallSchema, { service: "s", method: "m" }),
              }),
            },
          }),
        },
      ],
    });
    const outer = create(ViewDescriptorSchema, {
      id: "outer",
      title: "Outer",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      slots: [{ id: "sub", role: "content", position: 0, subView: nested }],
    });
    for (const kit of [htmlKit, shadcnKit]) {
      const html = renderView(kit, outer);
      expect(html).toContain("Outer"); // outer view title
      expect(html).toContain("mer-slot-subview"); // the nested-view slot
      expect(html).toContain("Nested Section"); // the nested view's own header (recursion)
      expect(html).toContain("INNER-PLACEHOLDER"); // the nested panel actually rendered
      expect(html).not.toContain("unsupported panel shape");
    }
  });
});
