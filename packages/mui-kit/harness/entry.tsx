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

import {
  BooleanToggleSchema,
  EnumSelectionSchema,
  type FormField,
  FormFieldSchema,
  IntegerSpinnerSchema,
  MaskedInputSchema,
  NestedFormSchema,
  NumberInputSchema,
  RepeatedFieldSchema,
  TextInputSchema,
} from "@savvifi/meridian-proto-ts/proto/form_pb.js";
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
import { PaletteSchema, type Theme, ThemeSchema } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
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

// ── sample skins, so the catalog shows themed MUI (light + dark + a 2nd skin) ──
const skin = create(ThemeSchema, {
  id: "savvi",
  light: create(PaletteSchema, {
    bg: "#ffffff",
    surface: "#ffffff",
    fg: "#1a2027",
    muted: "#5b6b7b",
    border: "#e3e8ee",
    accent: "#2f6f4f",
    accentStrong: "#1f4d37",
  }),
  dark: create(PaletteSchema, {
    bg: "#0f1419",
    surface: "#1a222c",
    fg: "#e6edf3",
    muted: "#9aa7b4",
    border: "#2b3743",
    accent: "#5fb98c",
    accentStrong: "#3f9d6f",
  }),
});

// A second skin (indigo) to show the theme range in the catalog.
const skinIndigo = create(ThemeSchema, {
  id: "indigo",
  light: create(PaletteSchema, {
    bg: "#ffffff",
    surface: "#ffffff",
    fg: "#1a1d2b",
    muted: "#5b607b",
    border: "#e5e6f0",
    accent: "#4f46e5",
    accentStrong: "#3730a3",
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

// State invokers: empty (no rows), loading (never resolves → spinner), error (rejects).
const emptyInvoker: RpcInvoker = { invoke: async () => ({ products: [] }) };
const loadingInvoker: RpcInvoker = { invoke: () => new Promise(() => {}) };
const errorInvoker: RpcInvoker = { invoke: async () => { throw new Error("boom"); } };

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

// Typed form fields — one per FormField.kind, so the browser test + catalog cover
// the full 0.16 vocabulary (integer / number / boolean / enum / masked + nested +
// repeated). The plain `configForm` above sets no kind (everything renders as text).
function typedFields(): FormField[] {
  return [
    create(FormFieldSchema, {
      fieldId: "quantity",
      label: "Quantity",
      description: "Whole units",
      kind: { case: "integer", value: create(IntegerSpinnerSchema, { min: 0, max: 100, defaultValue: 3, step: 1 }) },
    }),
    create(FormFieldSchema, {
      fieldId: "price",
      label: "Unit price",
      description: "USD",
      kind: { case: "number", value: create(NumberInputSchema, { min: 0, max: 9999, defaultValue: 9.99, step: 0.01 }) },
    }),
    create(FormFieldSchema, {
      fieldId: "active",
      label: "Active",
      description: "Visible in the catalog",
      kind: { case: "boolean", value: create(BooleanToggleSchema, { defaultValue: true }) },
    }),
    create(FormFieldSchema, {
      fieldId: "tier",
      label: "Tier",
      kind: {
        case: "enumSelection",
        value: create(EnumSelectionSchema, { allowedValues: ["bronze", "silver", "gold"], defaultValue: "silver" }),
      },
    }),
    create(FormFieldSchema, {
      fieldId: "sku",
      label: "SKU",
      kind: { case: "text", value: create(TextInputSchema, { defaultValue: "WID-001" }) },
    }),
    create(FormFieldSchema, {
      fieldId: "apiKey",
      label: "API key",
      kind: { case: "masked", value: create(MaskedInputSchema, {}) },
    }),
    create(FormFieldSchema, {
      fieldId: "dimensions",
      label: "Dimensions",
      description: "Nested object",
      kind: {
        case: "nested",
        value: create(NestedFormSchema, {
          fields: [
            create(FormFieldSchema, {
              fieldId: "width",
              label: "Width (cm)",
              kind: { case: "number", value: create(NumberInputSchema, { defaultValue: 10, step: 0.5 }) },
            }),
            create(FormFieldSchema, {
              fieldId: "height",
              label: "Height (cm)",
              kind: { case: "number", value: create(NumberInputSchema, { defaultValue: 5, step: 0.5 }) },
            }),
          ],
        }),
      },
    }),
    create(FormFieldSchema, {
      fieldId: "tags",
      label: "Tags",
      requestField: "tags",
      kind: {
        case: "repeated",
        value: create(RepeatedFieldSchema, {
          element: {
            case: "scalar",
            value: create(FormFieldSchema, { fieldId: "tag", label: "Tag", kind: { case: "text", value: create(TextInputSchema, {}) } }),
          },
          minItems: 1,
          maxItems: 5,
          addLabel: "Add tag",
        }),
      },
    }),
  ];
}

function typedFormPanel(mode: FormMode) {
  return create(PanelDescriptorSchema, {
    panelId: "typed",
    title: "Typed Fields",
    body: {
      case: "form",
      value: create(FormPanelSchema, {
        mode,
        itemNoun: "product",
        submit: create(RpcCallSchema, { service: "savvi.studio.product", method: "save" }),
        fields: typedFields(),
      }),
    },
  });
}

// A repeated field whose element is itself a nested sub-form — proves the renderer
// recurses (a list of sub-forms, each with its own fields incl. a boolean).
function repeatedNestedPanel(mode: FormMode) {
  return create(PanelDescriptorSchema, {
    panelId: "variants",
    title: "Variants",
    body: {
      case: "form",
      value: create(FormPanelSchema, {
        mode,
        itemNoun: "product",
        submit: create(RpcCallSchema, { service: "savvi.studio.product", method: "save" }),
        fields: [
          create(FormFieldSchema, {
            fieldId: "variants",
            label: "Variants",
            requestField: "variants",
            kind: {
              case: "repeated",
              value: create(RepeatedFieldSchema, {
                addLabel: "Add variant",
                minItems: 1,
                maxItems: 3,
                element: {
                  case: "object",
                  value: create(NestedFormSchema, {
                    fields: [
                      create(FormFieldSchema, {
                        fieldId: "color",
                        label: "Color",
                        kind: { case: "text", value: create(TextInputSchema, { defaultValue: "" }) },
                      }),
                      create(FormFieldSchema, {
                        fieldId: "inStock",
                        label: "In stock",
                        kind: { case: "boolean", value: create(BooleanToggleSchema, { defaultValue: true }) },
                      }),
                    ],
                  }),
                },
              }),
            },
          }),
        ],
      }),
    },
  });
}

// nav.groups shape: RepeatedField{object{label, kinds:RepeatedField{scalar}}}.
// Proves add/remove/reorder on a list of nested sub-forms where each row contains
// its own child repeated field — the exact shape a MeridianSite nav descriptor uses.
function navGroupsPanel(): ReturnType<typeof typedFormPanel> {
  return create(PanelDescriptorSchema, {
    panelId: "nav-groups",
    title: "Navigation Groups",
    body: {
      case: "form",
      value: create(FormPanelSchema, {
        mode: FormMode.EDIT,
        itemNoun: "site",
        submit: create(RpcCallSchema, { service: "savvi.studio.site", method: "save" }),
        fields: [
          create(FormFieldSchema, {
            fieldId: "groups",
            label: "Groups",
            requestField: "groups",
            kind: {
              case: "repeated",
              value: create(RepeatedFieldSchema, {
                addLabel: "Add section",
                minItems: 0,
                maxItems: 0,
                element: {
                  case: "object",
                  value: create(NestedFormSchema, {
                    fields: [
                      create(FormFieldSchema, {
                        fieldId: "label",
                        label: "Label",
                        kind: { case: "text", value: create(TextInputSchema, { defaultValue: "" }) },
                      }),
                      create(FormFieldSchema, {
                        fieldId: "kinds",
                        label: "Kinds",
                        requestField: "kinds",
                        kind: {
                          case: "repeated",
                          value: create(RepeatedFieldSchema, {
                            addLabel: "Add kind",
                            minItems: 0,
                            maxItems: 0,
                            element: {
                              case: "scalar",
                              value: create(FormFieldSchema, {
                                fieldId: "kind",
                                label: "Kind",
                                kind: { case: "text", value: create(TextInputSchema, { defaultValue: "" }) },
                              }),
                            },
                          }),
                        },
                      }),
                    ],
                  }),
                },
              }),
            },
          }),
        ],
      }),
    },
  });
}

// A DETAIL view wrapping one form panel (mirrors the form-readonly / form-edit shape).
function formView(id: string, title: string, panel: ReturnType<typeof typedFormPanel>): ViewDescriptor {
  return create(ViewDescriptorSchema, {
    id,
    title,
    kind: ViewKind.DETAIL,
    layout: { mode: { case: "stacked", value: {} } },
    slots: [{ id: "typed", role: "configuration", position: 10, title, panel }],
  });
}

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
  /** Skin override (defaults to `skin`). */
  theme?: Theme;
  /** light | dark (defaults to light). */
  mode?: "light" | "dark";
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
    name: "form-typed-edit",
    label: "Form · typed fields (all kinds)",
    group: "Primitives",
    invoker: noopInvoker,
    view: formView("form-typed-edit", "Typed Fields", typedFormPanel(FormMode.EDIT)),
  },
  {
    name: "form-typed-readonly",
    label: "Form · typed fields, read-only",
    group: "Primitives",
    invoker: noopInvoker,
    view: formView("form-typed-readonly", "Typed Fields", typedFormPanel(FormMode.READONLY)),
  },
  {
    name: "form-repeated-nested",
    label: "Form · repeated list of sub-forms",
    group: "Primitives",
    invoker: noopInvoker,
    view: formView("form-repeated-nested", "Variants", repeatedNestedPanel(FormMode.EDIT)),
  },
  {
    name: "form-nav-groups",
    label: "Form · nav.groups (add/remove/reorder sections + kinds)",
    group: "Primitives",
    invoker: noopInvoker,
    view: formView("form-nav-groups", "Navigation Groups", navGroupsPanel()),
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

  // ── States ──
  {
    name: "table-empty",
    label: "Table · empty state",
    group: "States",
    invoker: emptyInvoker,
    view: listView("table-empty", tablePanel("list-empty", "products")),
  },
  {
    name: "table-loading",
    label: "Table · loading state",
    group: "States",
    invoker: loadingInvoker,
    view: listView("table-loading", tablePanel("list-loading", "products")),
  },
  {
    name: "table-error",
    label: "Table · error state (failed fetch)",
    group: "States",
    invoker: errorInvoker,
    view: listView("table-error", tablePanel("list-error", "products")),
  },

  // ── Theming ──
  {
    name: "dark-table",
    label: "Dark · table",
    group: "Theming",
    invoker: clientInvoker,
    mode: "dark",
    view: listView("dark-table", tablePanel("list-products", "products")),
  },
  {
    name: "dark-detail",
    label: "Dark · stacked detail (header + form)",
    group: "Theming",
    invoker: noopInvoker,
    mode: "dark",
    view: create(ViewDescriptorSchema, {
      id: "dark-detail",
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
    name: "dark-tabbed",
    label: "Dark · tabbed",
    group: "Theming",
    invoker: clientInvoker,
    mode: "dark",
    view: create(ViewDescriptorSchema, {
      id: "dark-tabbed",
      title: "Product Details",
      kind: ViewKind.DETAIL,
      layout: { mode: { case: "tabbed", value: {} } },
      slots: [
        { id: "overview", role: "content", position: 10, placement: { tabLabel: "Overview", tabPosition: 0 }, panel: configForm(FormMode.READONLY) },
        { id: "items", role: "content", position: 20, placement: { tabLabel: "Items", tabPosition: 1 }, panel: tablePanel("list-products", "products") },
      ],
    }),
  },
  {
    name: "dark-form-typed",
    label: "Dark · typed fields",
    group: "Theming",
    invoker: noopInvoker,
    mode: "dark",
    view: formView("dark-form-typed", "Typed Fields", typedFormPanel(FormMode.EDIT)),
  },
  {
    name: "skin-indigo",
    label: "Skin · indigo (2nd theme)",
    group: "Theming",
    invoker: clientInvoker,
    theme: skinIndigo,
    view: listView("skin-indigo", tablePanel("list-products", "products")),
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
  // Paint the page background for the active mode so dark fixtures read correctly.
  const palette = (fixture.mode === "dark" ? (fixture.theme ?? skin).dark : (fixture.theme ?? skin).light);
  container.style.background = palette?.bg ?? "#ffffff";
  // Key by fixture name so switching fixtures fully remounts the subtree — each
  // fixture renders with fresh component state (e.g. a form's seeded initial
  // values), never inheriting the previous fixture's state at the same position.
  root.render(
    createElement(
      MeridianMuiProvider,
      { key: name, invoker: fixture.invoker, theme: fixture.theme ?? skin, mode: fixture.mode ?? "light", adhoc },
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
