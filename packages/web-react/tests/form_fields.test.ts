// form_fields.test.ts — tests for the shared FormField / NestedForm /
// RepeatedField renderer (form_fields.tsx). Uses renderToStaticMarkup for the
// initial-render (SSR) structural checks; interactive behaviour (add/remove/
// reorder state changes) is exercised in the catalog/storybook fixture.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import {
  FormFieldSchema,
  NestedFormSchema,
  RepeatedFieldSchema,
  TextInputSchema,
  BooleanToggleSchema,
  IntegerSpinnerSchema,
  EnumSelectionSchema,
} from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import {
  FormMode,
  FormPanelSchema,
  PanelDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { FIXTURES } from "./fixtures.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

function renderFormPanel(fields: ReturnType<typeof create<typeof FormFieldSchema>>[], mode = FormMode.EDIT): string {
  const descriptor = create(PanelDescriptorSchema, {
    panelId: "test-form",
    title: "Test Form",
    body: {
      case: "form",
      value: create(FormPanelSchema, { mode, fields }),
    },
  });
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit: htmlKit, adhoc: {} },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}

// ── Scalar fields ──────────────────────────────────────────────────────────────

describe("FormFieldRow — scalar fields (htmlKit, EDIT mode)", () => {
  it("renders a text field with label and input", () => {
    const field = create(FormFieldSchema, {
      fieldId: "name",
      label: "Full name",
      requestField: "name",
      kind: { case: "text", value: create(TextInputSchema, {}) },
    });
    const html = renderFormPanel([field]);
    expect(html).toContain("Full name");
    expect(html).toContain('type="text"');
    expect(html).toContain('name="name"');
  });

  it("renders a boolean toggle as a checkbox", () => {
    const field = create(FormFieldSchema, {
      fieldId: "active",
      label: "Active",
      requestField: "active",
      kind: { case: "boolean", value: create(BooleanToggleSchema, { defaultValue: true }) },
    });
    const html = renderFormPanel([field]);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("renders an integer spinner with min/max", () => {
    const field = create(FormFieldSchema, {
      fieldId: "count",
      label: "Count",
      requestField: "count",
      kind: {
        case: "integer",
        value: create(IntegerSpinnerSchema, { min: 1, max: 10, step: 1 }),
      },
    });
    const html = renderFormPanel([field]);
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="10"');
  });

  it("renders an enum selection as a <select>", () => {
    const field = create(FormFieldSchema, {
      fieldId: "tier",
      label: "Tier",
      requestField: "tier",
      kind: {
        case: "enumSelection",
        value: create(EnumSelectionSchema, {
          allowedValues: ["free", "pro", "enterprise"],
          defaultValue: "pro",
        }),
      },
    });
    const html = renderFormPanel([field]);
    expect(html).toContain("<select");
    expect(html).toContain("free");
    expect(html).toContain("pro");
    expect(html).toContain("enterprise");
  });

  it("renders a read-only text field as a span in READONLY mode", () => {
    const field = create(FormFieldSchema, {
      fieldId: "id",
      label: "ID",
      requestField: "id",
      kind: { case: "text", value: create(TextInputSchema, {}) },
    });
    const html = renderFormPanel([field], FormMode.READONLY);
    expect(html).not.toContain('<input');
    expect(html).toContain('data-field="id"');
  });
});

// ── NestedForm ─────────────────────────────────────────────────────────────────

describe("FormFieldRow — nested sub-form (htmlKit, EDIT mode)", () => {
  it("renders a nested form with its child fields", () => {
    const field = create(FormFieldSchema, {
      fieldId: "address",
      label: "Address",
      requestField: "address",
      kind: {
        case: "nested",
        value: create(NestedFormSchema, {
          fields: [
            create(FormFieldSchema, {
              fieldId: "street",
              label: "Street",
              requestField: "street",
              kind: { case: "text", value: create(TextInputSchema, {}) },
            }),
            create(FormFieldSchema, {
              fieldId: "city",
              label: "City",
              requestField: "city",
              kind: { case: "text", value: create(TextInputSchema, {}) },
            }),
          ],
        }),
      },
    });
    const html = renderFormPanel([field]);
    expect(html).toContain("Address");
    expect(html).toContain("Street");
    expect(html).toContain("City");
    // Child names are prefixed with the parent path
    expect(html).toContain('name="address.street"');
    expect(html).toContain('name="address.city"');
  });
});

// ── RepeatedField ──────────────────────────────────────────────────────────────

describe("RepeatedFieldControl — initial render (htmlKit, EDIT mode)", () => {
  it("shows the Add button with add_label", () => {
    const field = create(FormFieldSchema, {
      fieldId: "tags",
      label: "Tags",
      requestField: "tags",
      kind: {
        case: "repeated",
        value: create(RepeatedFieldSchema, {
          element: {
            case: "scalar",
            value: create(FormFieldSchema, {
              fieldId: "tag",
              requestField: "tag",
              kind: { case: "text", value: create(TextInputSchema, {}) },
            }),
          },
          addLabel: "Add tag",
        }),
      },
    });
    const html = renderFormPanel([field]);
    expect(html).toContain("Add tag");
    expect(html).toContain("data-repeated-add");
  });

  it("pre-populates min_items rows on initial render", () => {
    const field = create(FormFieldSchema, {
      fieldId: "tags",
      label: "Tags",
      requestField: "tags",
      kind: {
        case: "repeated",
        value: create(RepeatedFieldSchema, {
          element: {
            case: "scalar",
            value: create(FormFieldSchema, {
              fieldId: "tag",
              requestField: "tag",
              kind: { case: "text", value: create(TextInputSchema, {}) },
            }),
          },
          minItems: 2,
          addLabel: "Add tag",
        }),
      },
    });
    const html = renderFormPanel([field]);
    // Two rows → two indexed name attributes
    expect(html).toContain('name="tags[0]"');
    expect(html).toContain('name="tags[1]"');
    // Remove button present per row
    expect(html.match(/aria-label="Remove"/g)?.length).toBe(2);
  });

  it("hides Add/Remove/reorder controls in READONLY mode", () => {
    const field = create(FormFieldSchema, {
      fieldId: "tags",
      label: "Tags",
      requestField: "tags",
      kind: {
        case: "repeated",
        value: create(RepeatedFieldSchema, {
          element: {
            case: "scalar",
            value: create(FormFieldSchema, {
              fieldId: "tag",
              requestField: "tag",
              kind: { case: "text", value: create(TextInputSchema, {}) },
            }),
          },
          minItems: 1,
          addLabel: "Add tag",
        }),
      },
    });
    const html = renderFormPanel([field], FormMode.READONLY);
    expect(html).not.toContain("Add tag");
    expect(html).not.toContain('aria-label="Remove"');
    expect(html).not.toContain('aria-label="Move up"');
  });

  it("renders object-element rows with per-row sub-field names", () => {
    const field = create(FormFieldSchema, {
      fieldId: "groups",
      label: "Groups",
      requestField: "groups",
      kind: {
        case: "repeated",
        value: create(RepeatedFieldSchema, {
          element: {
            case: "object",
            value: create(NestedFormSchema, {
              fields: [
                create(FormFieldSchema, {
                  fieldId: "name",
                  label: "Name",
                  requestField: "name",
                  kind: { case: "text", value: create(TextInputSchema, {}) },
                }),
              ],
            }),
          },
          minItems: 1,
          addLabel: "Add group",
        }),
      },
    });
    const html = renderFormPanel([field]);
    // Row 0 nested field name
    expect(html).toContain('name="groups[0].name"');
    expect(html).toContain("Add group");
  });

  it("respects max_items: add button disabled when at capacity (data-max attribute)", () => {
    const field = create(FormFieldSchema, {
      fieldId: "slots",
      label: "Slots",
      requestField: "slots",
      kind: {
        case: "repeated",
        value: create(RepeatedFieldSchema, {
          element: {
            case: "scalar",
            value: create(FormFieldSchema, {
              fieldId: "slot",
              requestField: "slot",
              kind: { case: "text", value: create(TextInputSchema, {}) },
            }),
          },
          minItems: 0,
          maxItems: 3,
          addLabel: "Add slot",
        }),
      },
    });
    const html = renderFormPanel([field]);
    expect(html).toContain('data-max="3"');
  });
});

// ── Acceptance-criterion fixture ───────────────────────────────────────────────

describe("Acceptance fixture: RepeatedField{object{label, kinds:RepeatedField{scalar}}}", () => {
  it("renders without crashing through htmlKit and shows the panel title", () => {
    const fx = FIXTURES.find((f) => f.name === "form")!;
    expect(fx).toBeDefined();
    const html = renderToStaticMarkup(
      createElement(
        MeridianProvider,
        { invoker, kit: htmlKit, adhoc: {} },
        createElement(PanelRenderer, { descriptor: fx.descriptor }),
      ),
    );
    expect(html).toContain("Navigation");
    expect(html).toContain("Add section");
    expect(html).toContain("Navigation groups");
  });

  it("renders without crashing through shadcnKit", () => {
    const fx = FIXTURES.find((f) => f.name === "form")!;
    const html = renderToStaticMarkup(
      createElement(
        MeridianProvider,
        { invoker, kit: shadcnKit, adhoc: {} },
        createElement(PanelRenderer, { descriptor: fx.descriptor }),
      ),
    );
    expect(html).toContain("Navigation");
    expect(html).toContain("Add section");
  });

  it("html output does not use fallback", () => {
    const fx = FIXTURES.find((f) => f.name === "form")!;
    const html = renderToStaticMarkup(
      createElement(
        MeridianProvider,
        { invoker, kit: htmlKit, adhoc: {} },
        createElement(PanelRenderer, { descriptor: fx.descriptor }),
      ),
    );
    expect(html).not.toContain("unsupported panel shape");
  });
});
