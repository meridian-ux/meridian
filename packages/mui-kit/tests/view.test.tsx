// aionMuiKit round-trip over the two REAL studio views (products list + detail).
//
// The same ViewDescriptors proven in meridian-web-react (htmlKit + shadcnKit)
// are rendered here through ViewRenderer + aionMuiKit — i.e. painted with the
// actual @aion/ui MUI components (DataTableView, FormView). This is a CLIENT
// render (jsdom): the list view's `populate` RPC is served by the test invoker,
// so we assert the real path end to end — the MUI table renders its column
// headers AND the populated row cells; the FormPanel renders its field labels;
// the view/slot Actions render as MUI buttons.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import {
  FormMode,
  FormPanelSchema,
  PanelDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  PaginationMode,
  PaginationSchema,
  TablePanelSchema,
} from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import {
  ActionPlacement,
  type ViewDescriptor,
  ViewDescriptorSchema,
  ViewKind,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { ViewRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

// The list view's populate RPC → fixture rows (keyed by the columns' field_path).
const invoker: RpcInvoker = {
  invoke: async (_service, method) => {
    if (method === "list-products") {
      return {
        products: [
          { name: "Widget", type: "physical", status: "approved" },
          { name: "Gadget", type: "digital", status: "pending" },
        ],
      };
    }
    return {};
  },
};

// The entity-detail-header is a bespoke aion widget → an AdhocPanel; the host
// supplies a handler (a minimal stand-in here).
const adhoc = {
  "entity-detail-header": () => <div className="mer-detail-header">detail header</div>,
};

function renderView(view: ViewDescriptor) {
  return render(
    <MeridianMuiProvider invoker={invoker} adhoc={adhoc}>
      <ViewRenderer view={view} />
    </MeridianMuiProvider>,
  );
}

/** MUI renders some text more than once (label + fieldset legend), so match ≥1. */
async function expectText(text: string): Promise<void> {
  const matches = await screen.findAllByText(text);
  expect(matches.length).toBeGreaterThan(0);
}

const PRODUCT_ACTIONS = ["edit", "clone", "delete", "export_yaml"].map((id) => ({
  id,
  label: id === "export_yaml" ? "Export YAML" : id[0].toUpperCase() + id.slice(1),
  placement: ActionPlacement.HEADER,
  call: create(RpcCallSchema, { service: "savvi.studio.product", method: id }),
}));

// products/views/list-view.aion → ListLayout + one TablePanel content slot.
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
            columns: [
              { header: "Name", fieldPath: "name" },
              { header: "Type", fieldPath: "type" },
              { header: "Status", fieldPath: "status" },
            ],
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

// products/views/detail-view.aion → StackedLayout + header + configuration FormPanel.
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
      title: "Product Configuration",
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

describe("aionMuiKit renders the real studio views via @aion/ui (MUI)", () => {
  it("LIST view: MUI table with headers + populated rows + header actions", async () => {
    renderView(productsListView);
    await expectText("Name"); // column header (renders once rows populate)
    await expectText("Status");
    await expectText("Widget"); // populated cell value (populate RPC → rows)
    await expectText("Gadget");
    await expectText("Export YAML"); // a view header action (MUI button)
  });

  it("DETAIL view: FormPanel field labels + adhoc header + actions", async () => {
    renderView(productsDetailView);
    await expectText("detail header"); // adhoc slot handler
    await expectText("Product Type"); // FormView field labels (READONLY)
    await expectText("Review Status");
    await expectText("Attributes");
    await expectText("Delete"); // a view header action
  });
});

// OFFSET server pagination: the invoker returns one page per offset; advancing the
// MUI pager re-invokes populate with the next offset (usePagedRows → DataTableView).
const PAGE_ROWS = ["Alpha", "Bravo", "Charlie", "Delta"].map((name) => ({ name }));
const pagedInvoker: RpcInvoker = {
  invoke: async (_service, method, request) => {
    if (method === "list-paged") {
      const offset = (request as { offset?: number }).offset ?? 0;
      const limit = (request as { limit?: number }).limit ?? 2;
      return { products: PAGE_ROWS.slice(offset, offset + limit), total: PAGE_ROWS.length };
    }
    return {};
  },
};

const pagedListView: ViewDescriptor = create(ViewDescriptorSchema, {
  id: "paged-list-view",
  title: "Paged Products",
  kind: ViewKind.LIST,
  layout: { mode: { case: "list", value: {} } },
  slots: [
    {
      id: "content",
      role: "content",
      position: 10,
      panel: create(PanelDescriptorSchema, {
        panelId: "paged-list",
        title: "Paged",
        body: {
          case: "table",
          value: create(TablePanelSchema, {
            rowsField: "products",
            columns: [{ header: "Name", fieldPath: "name" }],
            populate: create(RpcCallSchema, { service: "svc", method: "list-paged" }),
            pagination: create(PaginationSchema, {
              mode: PaginationMode.OFFSET,
              pageSize: 2,
              offsetRequestField: "offset",
              limitRequestField: "limit",
              totalField: "total",
            }),
          }),
        },
      }),
    },
  ],
});

describe("aionMuiKit OFFSET pagination (server paging via the invoker)", () => {
  it("fetches page 1, then advances to page 2 via the MUI pager", async () => {
    render(
      <MeridianMuiProvider invoker={pagedInvoker}>
        <ViewRenderer view={pagedListView} />
      </MeridianMuiProvider>,
    );
    // page 1 (offset 0)
    await expectText("Alpha");
    await expectText("Bravo");
    expect(screen.queryByText("Charlie")).toBeNull();
    // advance — re-invokes populate with offset=2
    const next = await screen.findByRole("button", { name: /go to next page/i });
    fireEvent.click(next);
    // page 2 (offset 2)
    await expectText("Charlie");
    await expectText("Delta");
  });
});
