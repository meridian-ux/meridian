// Browser harness — the single source of every meridian primitive + layout,
// bundled by esbuild into a self-contained IIFE and driven in real (hermetic)
// Chrome by:
//   • the playwright_chrome_js_test specs (0-tolerance real-browser assertions), and
//   • the screenshot capture that feeds the rules_tectonic visual catalog.
//
// It exposes `window.meridianHarness`:
//   .list()            → [{ name, label, group }]  (catalog manifest)
//   .render(name)      → mount a fixture into #root (returns a Promise that
//                        resolves once its async data has populated + painted)
//
// One bundle, every fixture — so the tests and the catalog can never drift from
// what the kit actually renders.

import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import {
  FormMode,
  FormPanelSchema,
  PanelDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import { LroPanelSchema } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  PaginationMode,
  PaginationSchema,
  TablePanelSchema,
} from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { PaletteSchema, ThemeSchema } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import {
  ActionPlacement,
  Column,
  type ViewDescriptor,
  ViewDescriptorSchema,
  ViewKind,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { ViewRenderer } from "@savvifi/meridian-web-react";

import { MeridianMuiProvider } from "../src/index.js";

// ── a sample skin, so the catalog shows themed MUI ──────────────────────────
const skin = create(ThemeSchema, {
  id: "sample",
  light: create(PaletteSchema, {
    bg: "#ffffff",
    surface: "#ffffff",
    fg: "#1a2027",
    muted: "#5b6b7b",
    border: "#e3e8ee",
    accent: "#2f6f4f",
    accentStrong: "#1f4d37",
  }),
});

// ── invokers (deterministic) ────────────────────────────────────────────────
const PRODUCTS = [
  { name: "Widget", type: "physical", status: "approved" },
  { name: "Gadget", type: "digital", status: "pending" },
  { name: "Gizmo", type: "physical", status: "approved" },
  { name: "Sprocket", type: "service", status: "draft" },
];

const clientInvoker: RpcInvoker = {
  invoke: async (_s, method) =>
    method === "list-products" ? { products: PRODUCTS } : {},
};

const offsetInvoker: RpcInvoker = {
  invoke: async (_s, method, req) => {
    if (method !== "list-offset") return {};
    const offset = (req as { offset?: number }).offset ?? 0;
    const limit = (req as { limit?: number }).limit ?? 2;
    return { products: PRODUCTS.slice(offset, offset + limit), total: PRODUCTS.length };
  },
};

const cursorInvoker: RpcInvoker = {
  invoke: async (_s, method, req) => {
    if (method !== "list-cursor") return {};
    const cursor = (req as { cursor?: string }).cursor ?? "";
    if (cursor === "") return { items: PRODUCTS.slice(0, 2), nextCursor: "c1" };
    if (cursor === "c1") return { items: PRODUCTS.slice(2, 4), nextCursor: "" };
    return { items: [], nextCursor: "" };
  },
};

const noopInvoker: RpcInvoker = { invoke: async () => ({}) };

// ── builders ────────────────────────────────────────────────────────────────
const productActions = ["edit", "clone", "delete", "export_yaml"].map((id) => ({
  id,
  label: id === "export_yaml" ? "Export YAML" : id[0].toUpperCase() + id.slice(1),
  placement: ActionPlacement.HEADER,
  call: create(RpcCallSchema, { service: "savvi.studio.product", method: id }),
}));

const productColumns = [
  { header: "Name", fieldPath: "name" },
  { header: "Type", fieldPath: "type" },
  { header: "Status", fieldPath: "status" },
];

function tablePanel(method: string, rowsField: string, pagination?: unknown) {
  return create(PanelDescriptorSchema, {
    panelId: `${method}-panel`,
    title: "Products",
    body: {
      case: "table",
      value: create(TablePanelSchema, {
        itemNoun: "product",
        rowsField,
        placeholder: "No products.",
        columns: productColumns,
        populate: create(RpcCallSchema, { service: "savvi.studio.product", method }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pagination: pagination as any,
      }),
    },
  });
}

function listView(id: string, panel: ReturnType<typeof tablePanel>): ViewDescriptor {
  return create(ViewDescriptorSchema, {
    id,
    title: "Products",
    subjectKind: "products",
    kind: ViewKind.LIST,
    layout: { mode: { case: "list", value: {} } },
    actions: productActions,
    slots: [{ id: "content", role: "content", position: 10, panel }],
  });
}

const configForm = (mode: FormMode) =>
  create(PanelDescriptorSchema, {
    panelId: "config",
    title: "Product Configuration",
    body: {
      case: "form",
      value: create(FormPanelSchema, {
        mode,
        itemNoun: "product",
        submit: create(RpcCallSchema, { service: "savvi.studio.product", method: "save" }),
        fields: [
          create(FormFieldSchema, { fieldId: "type", label: "Product Type" }),
          create(FormFieldSchema, { fieldId: "status", label: "Review Status" }),
          create(FormFieldSchema, { fieldId: "data", label: "Attributes" }),
        ],
      }),
    },
  });

const headerSlot = {
  id: "header",
  role: "header",
  position: 10,
  panel: create(PanelDescriptorSchema, {
    panelId: "header",
    title: "Product",
    body: { case: "adhoc", value: { handlerId: "entity-detail-header" } },
  }),
};

// ── fixtures ────────────────────────────────────────────────────────────────
interface Fixture {
  name: string;
  label: string;
  group: string;
  view: ViewDescriptor;
  invoker: RpcInvoker;
}

const fixtures: Fixture[] = [
  {
    name: "table-client",
    label: "Table · client pagination",
    group: "Primitives",
    invoker: clientInvoker,
    view: listView("table-client", tablePanel("list-products", "products")),
  },
  {
    name: "table-offset",
    label: "Table · offset pagination",
    group: "Primitives",
    invoker: offsetInvoker,
    view: listView(
      "table-offset",
      tablePanel(
        "list-offset",
        "products",
        create(PaginationSchema, {
          mode: PaginationMode.OFFSET,
          pageSize: 2,
          offsetRequestField: "offset",
          limitRequestField: "limit",
          totalField: "total",
        }),
      ),
    ),
  },
  {
    name: "table-cursor",
    label: "Table · cursor pagination (aion default)",
    group: "Primitives",
    invoker: cursorInvoker,
    view: listView(
      "table-cursor",
      tablePanel(
        "list-cursor",
        "items",
        create(PaginationSchema, {
          mode: PaginationMode.CURSOR,
          pageSize: 2,
          cursorRequestField: "cursor",
          nextCursorField: "nextCursor",
        }),
      ),
    ),
  },
  {
    name: "form-readonly",
    label: "Form · read-only detail",
    group: "Primitives",
    invoker: noopInvoker,
    view: create(ViewDescriptorSchema, {
      id: "form-readonly",
      title: "Product Details",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      slots: [{ id: "config", role: "configuration", position: 10, title: "Configuration", panel: configForm(FormMode.READONLY) }],
    }),
  },
  {
    name: "form-edit",
    label: "Form · editable",
    group: "Primitives",
    invoker: noopInvoker,
    view: create(ViewDescriptorSchema, {
      id: "form-edit",
      title: "Edit Product",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      slots: [{ id: "config", role: "configuration", position: 10, title: "Edit", panel: configForm(FormMode.EDIT) }],
    }),
  },
  {
    name: "prompt",
    label: "Prompt · input collector",
    group: "Primitives",
    invoker: noopInvoker,
    view: create(ViewDescriptorSchema, {
      id: "prompt",
      title: "Confirm",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      slots: [
        {
          id: "prompt",
          role: "content",
          position: 10,
          panel: create(PanelDescriptorSchema, {
            panelId: "prompt",
            title: "Parameters",
            body: {
              case: "prompt",
              value: create(PromptPanelSchema, {
                description: "Fill parameters to continue.",
                acceptLabel: "Continue",
                fields: [create(FormFieldSchema, { fieldId: "region", label: "Region" })],
              }),
            },
          }),
        },
      ],
    }),
  },
  {
    name: "lro",
    label: "LRO · run + inputs",
    group: "Primitives",
    invoker: noopInvoker,
    view: create(ViewDescriptorSchema, {
      id: "lro",
      title: "Generate",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      slots: [
        {
          id: "lro",
          role: "content",
          position: 10,
          panel: create(PanelDescriptorSchema, {
            panelId: "lro",
            title: "Generate report",
            body: {
              case: "lro",
              value: create(LroPanelSchema, {
                start: create(RpcCallSchema, { service: "svc", method: "generate" }),
                metadataType: "svc.GenMeta",
                responseType: "svc.GenResp",
                runButtonLabel: "Generate",
                inputs: [create(FormFieldSchema, { fieldId: "count", label: "Count" })],
              }),
            },
          }),
        },
      ],
    }),
  },
  {
    name: "fallback",
    label: "Fallback · empty panel",
    group: "Primitives",
    invoker: noopInvoker,
    view: create(ViewDescriptorSchema, {
      id: "fallback",
      title: "Fallback",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      slots: [
        {
          id: "empty",
          role: "content",
          position: 10,
          panel: create(PanelDescriptorSchema, { panelId: "empty", title: "Empty" }),
        },
      ],
    }),
  },
  {
    name: "layout-stacked",
    label: "Layout · stacked (header + form)",
    group: "Layouts",
    invoker: noopInvoker,
    view: create(ViewDescriptorSchema, {
      id: "layout-stacked",
      title: "Product Details",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "stacked", value: {} } },
      actions: productActions,
      slots: [
        headerSlot,
        { id: "config", role: "configuration", position: 30, title: "Configuration", panel: configForm(FormMode.READONLY) },
      ],
    }),
  },
  {
    name: "layout-tabbed",
    label: "Layout · tabbed",
    group: "Layouts",
    invoker: clientInvoker,
    view: create(ViewDescriptorSchema, {
      id: "layout-tabbed",
      title: "Product Details",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "tabbed", value: {} } },
      slots: [
        {
          id: "overview",
          role: "content",
          position: 10,
          placement: { tabLabel: "Overview", tabPosition: 0 },
          panel: configForm(FormMode.READONLY),
        },
        {
          id: "items",
          role: "content",
          position: 20,
          placement: { tabLabel: "Items", tabPosition: 1 },
          panel: tablePanel("list-products", "products"),
        },
      ],
    }),
  },
  {
    name: "layout-two-column",
    label: "Layout · two-column",
    group: "Layouts",
    invoker: clientInvoker,
    view: create(ViewDescriptorSchema, {
      id: "layout-two-column",
      title: "Product Details",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "twoColumn", value: {} } },
      slots: [
        {
          id: "main",
          role: "content",
          position: 10,
          title: "Items",
          placement: { column: Column.MAIN },
          panel: tablePanel("list-products", "products"),
        },
        {
          id: "side",
          role: "configuration",
          position: 20,
          title: "Configuration",
          placement: { column: Column.SIDEBAR },
          panel: configForm(FormMode.READONLY),
        },
      ],
    }),
  },
];

const adhoc = {
  "entity-detail-header": () =>
    createElement(
      "div",
      { className: "mer-detail-header", style: { padding: 12, fontWeight: 600 } },
      "Widget — product",
    ),
};

// ── harness API ─────────────────────────────────────────────────────────────
const byName = new Map(fixtures.map((f) => [f.name, f]));
let root: Root | undefined;

async function render(name: string): Promise<void> {
  const fixture = byName.get(name);
  if (!fixture) throw new Error(`unknown fixture: ${name}`);
  const container = document.getElementById("root");
  if (!container) throw new Error("no #root");
  if (!root) root = createRoot(container);
  root.render(
    createElement(
      MeridianMuiProvider,
      { invoker: fixture.invoker, theme: skin, adhoc },
      createElement(ViewRenderer, { view: fixture.view }),
    ),
  );
  // let effects (populate RPCs) + a paint settle.
  await new Promise((r) => setTimeout(r, 150));
}

declare global {
  interface Window {
    meridianHarness: {
      list: () => { name: string; label: string; group: string }[];
      render: (name: string) => Promise<void>;
    };
  }
}

window.meridianHarness = {
  list: () => fixtures.map((f) => ({ name: f.name, label: f.label, group: f.group })),
  render,
};
