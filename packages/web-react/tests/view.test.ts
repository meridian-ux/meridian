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

  // Repeater: a slot with sub_view + sub_view_populate renders the sub_view once
  // PER ROW. Seeded via initialData so SSR is synchronous (effects don't run under
  // renderToStaticMarkup). The record-bound CONTENT of each item is proven in the
  // mui-kit round (html/shadcn Table/DetailHeader are stubs).
  it("repeats sub_view once per row (dynamic composition)", () => {
    const flowTemplate = create(ViewDescriptorSchema, {
      id: "flow",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "list", value: {} } },
      slots: [
        {
          id: "steps",
          role: "content",
          position: 0,
          panel: create(PanelDescriptorSchema, {
            panelId: "steps",
            body: {
              case: "table",
              // no populate → record-scoped (rows from the row's `steps`)
              value: create(TablePanelSchema, { rowsField: "steps", placeholder: "STEP", columns: [{ header: "Step" }] }),
            },
          }),
        },
      ],
    });
    const plan = create(ViewDescriptorSchema, {
      id: "plan",
      title: "Plan",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      slots: [
        {
          id: "flows",
          role: "content",
          position: 0,
          subView: flowTemplate,
          subViewPopulate: create(RpcCallSchema, { service: "plan", method: "get" }),
          subViewRowsField: "flows",
        },
      ],
    });
    const initialData = { "plan.get": { rows: [{ title: "A" }, { title: "B" }, { title: "C" }] } };
    const html = renderToStaticMarkup(
      createElement(
        MeridianProvider,
        { invoker, kit: htmlKit, adhoc },
        createElement(ViewRenderer, { view: plan, initialData }),
      ),
    );
    // one repeated item per seeded flow row
    expect((html.match(/mer-subview-item/g) || []).length).toBe(3);
  });
});

// sponsor/views/detail-view.aion → TabbedLayout. The REAL projected shape: a header
// card and a plan-year selector that are NOT tabs (no tab_label; the selector sets
// placement.header_row), plus four genuinely tabbed slots.
//
// There was no tabbed coverage at all, which is why the drop-next rewrite shipped a
// TabbedSlots that turned every slot into a tab — the header card ended up behind a
// tab labeled "header" and the page rendered with no header.
const sponsorsDetailView: ViewDescriptor = create(ViewDescriptorSchema, {
  id: "sponsors-detail-view",
  title: "Sponsor Details",
  route: "/entities/sponsors/id/:entityId",
  subjectKind: "sponsors",
  kind: ViewKind.DETAIL,
  layout: { mode: { case: "tabbed", value: {} } },
  actions: [
    {
      id: "delete",
      label: "Delete",
      placement: ActionPlacement.HEADER,
      call: create(RpcCallSchema, { service: "savvi.studio.sponsor", method: "delete" }),
    },
  ],
  slots: [
    {
      id: "header",
      role: "header",
      position: 10,
      panel: create(PanelDescriptorSchema, {
        panelId: "header-adhoc",
        title: "",
        body: { case: "adhoc", value: { handlerId: "entity-detail-header" } },
      }),
    },
    {
      id: "plan-year-selector",
      role: "configuration",
      position: 15,
      placement: { headerRow: true },
      panel: create(PanelDescriptorSchema, {
        panelId: "plan-year-selector-adhoc",
        title: "",
        body: { case: "adhoc", value: { handlerId: "plan-year-selector" } },
      }),
    },
    {
      id: "summary",
      role: "configuration",
      position: 20,
      placement: { tabLabel: "Overview", tabPosition: 1 },
      panel: create(PanelDescriptorSchema, {
        panelId: "summary-adhoc",
        title: "",
        body: { case: "adhoc", value: { handlerId: "entity-detail-section" } },
      }),
    },
    {
      id: "tab-tasks",
      role: "tab-tasks",
      position: 30,
      placement: { tabLabel: "Tasks", tabPosition: 2 },
      panel: create(PanelDescriptorSchema, {
        panelId: "tab-tasks-table",
        title: "Tasks",
        body: {
          case: "table",
          value: create(TablePanelSchema, {
            itemNoun: "task",
            rowsField: "items",
            placeholder: "No tasks.",
            columns: [{ header: "Title" }],
            populate: create(RpcCallSchema, { service: "savvi.studio.task", method: "list" }),
          }),
        },
      }),
    },
    {
      id: "tab-products",
      role: "tab-products",
      position: 40,
      placement: { tabLabel: "Products", tabPosition: 3 },
      panel: create(PanelDescriptorSchema, {
        panelId: "tab-products-table",
        title: "Products",
        body: {
          case: "table",
          value: create(TablePanelSchema, {
            itemNoun: "product",
            rowsField: "items",
            placeholder: "No products.",
            columns: [{ header: "Name" }],
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

describe("ViewRenderer — TabbedLayout partitions tabs from regions", () => {
  const tabLabels = (html: string): string[] =>
    [...html.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1]);

  for (const kit of [htmlKit, shadcnKit]) {
    it(`makes ONLY tab_label slots into tabs via ${kit.id}`, () => {
      const labels = tabLabels(renderView(kit, sponsorsDetailView));
      // Exactly the labeled slots, in tab_position order.
      expect(labels).toEqual(["Overview", "Tasks", "Products"]);
      // The regression: unlabeled slots fell through to `|| s.id` and became tabs.
      expect(labels).not.toContain("header");
      expect(labels).not.toContain("plan-year-selector");
    });
  }

  it("renders the header card as a region ABOVE the tab strip, not behind a tab", () => {
    const html = renderView(htmlKit, sponsorsDetailView);
    expect(html).toContain('data-slot="header"');
    expect(html.indexOf('data-slot="header"')).toBeLessThan(html.indexOf('role="tablist"'));
  });

  it("pins a header_row slot INTO the view header, out of the body", () => {
    const html = renderView(htmlKit, sponsorsDetailView);
    // It rides the header row (before the tab strip), not the tab strip itself.
    expect(html).toContain("mer-view-header-slots");
    expect(html.indexOf('data-slot="plan-year-selector"')).toBeLessThan(
      html.indexOf('role="tablist"'),
    );
  });

  it("selects the FIRST TAB by default, not the header", () => {
    const html = renderView(htmlKit, sponsorsDetailView);
    // Previously `active = 0` pointed at the header slot, so the initial body was
    // the header panel and no real content showed.
    expect(html).toContain('aria-selected="true"');
    const firstSelected = /role="tab"[^>]*aria-selected="true"[^>]*>([^<]*)</.exec(html);
    expect(firstSelected?.[1]).toBe("Overview");
  });

  it("renders every non-tab region, not just the active tab's panel", () => {
    const html = renderView(htmlKit, sponsorsDetailView);
    expect(html).toContain('data-slot="header"');
    expect(html).toContain('data-slot="plan-year-selector"');
    // ...and the inactive tabs' bodies stay unmounted.
    expect(html).not.toContain('data-slot="tab-products"');
  });

  it("degrades a tabbed view with no tab_labels to a plain stack (no empty tablist)", () => {
    const noTabs = create(ViewDescriptorSchema, {
      id: "no-tabs-view",
      title: "No Tabs",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "tabbed", value: {} } },
      slots: [
        {
          id: "header",
          role: "header",
          position: 10,
          panel: create(PanelDescriptorSchema, {
            panelId: "header-adhoc",
            title: "",
            body: { case: "adhoc", value: { handlerId: "entity-detail-header" } },
          }),
        },
      ],
    });
    const html = renderView(htmlKit, noTabs);
    // No content is lost...
    expect(html).toContain('data-slot="header"');
    // ...and we don't emit a tablist with zero tabs (an a11y defect).
    expect(html).not.toContain('role="tablist"');
  });

  it("leaves non-tabbed layouts alone (no header_row ⇒ byte-identical body)", () => {
    // products detail is StackedLayout with no header_row slot — the partition
    // must be a no-op there.
    const html = renderView(htmlKit, productsDetailView);
    expect(html).not.toContain("mer-view-header-slots");
    expect(html).toContain('data-slot="header"');
    expect(html).toContain('data-slot="configuration"');
  });
});
