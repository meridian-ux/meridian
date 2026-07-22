// RepeatedField renderer — add/remove/reorder round-trip test.
//
// Proves end-to-end through MeridianMuiProvider + ViewRenderer + muiKit:
//   • A scalar RepeatedField (text items) seeds min_items rows, adds, removes, and
//     reorders via the up/down buttons.
//   • A nested RepeatedField (object rows with a child scalar RepeatedField) — the
//     nav.groups shape — adds sections, adds kinds per section, and reorders, then
//     the submit RPC receives the exact array a MeridianSite expects.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  FormFieldSchema,
  NestedFormSchema,
  RepeatedFieldSchema,
  TextInputSchema,
} from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { FormMode, FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { type ViewDescriptor, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { ViewRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

// ── helpers ──────────────────────────────────────────────────────────────────

function makeInvoker(onSave?: (req: unknown) => void): RpcInvoker {
  return {
    invoke: async (_service, method, req) => {
      if (method === "save" && onSave) onSave(req);
      return {};
    },
  };
}

function formView(panel: ReturnType<typeof create<typeof PanelDescriptorSchema>>): ViewDescriptor {
  return create(ViewDescriptorSchema, {
    id: "test-form",
    kind: ViewKind.DETAIL,
    layout: { mode: { case: "stacked", value: {} } },
    slots: [{ id: "main", role: "content", position: 0, panel }],
  });
}

// A scalar RepeatedField: a list of text "tag" items, min 1, max 5.
const scalarPanel = create(PanelDescriptorSchema, {
  panelId: "tags-form",
  title: "Tags",
  body: {
    case: "form",
    value: create(FormPanelSchema, {
      mode: FormMode.EDIT,
      itemNoun: "item",
      submit: create(RpcCallSchema, { service: "svc", method: "save" }),
      fields: [
        create(FormFieldSchema, {
          fieldId: "tags",
          label: "Tags",
          kind: {
            case: "repeated",
            value: create(RepeatedFieldSchema, {
              addLabel: "Add tag",
              minItems: 1,
              maxItems: 5,
              element: {
                case: "scalar",
                value: create(FormFieldSchema, {
                  fieldId: "tag",
                  label: "Tag",
                  kind: { case: "text", value: create(TextInputSchema, { defaultValue: "" }) },
                }),
              },
            }),
          },
        }),
      ],
    }),
  },
});

// A nested RepeatedField: nav.groups shape — list of sections, each section has a
// `label` text field and a `kinds` RepeatedField of scalar text items.
const navGroupsPanel = create(PanelDescriptorSchema, {
  panelId: "nav-groups-form",
  title: "Navigation Groups",
  body: {
    case: "form",
    value: create(FormPanelSchema, {
      mode: FormMode.EDIT,
      itemNoun: "site",
      submit: create(RpcCallSchema, { service: "svc", method: "save" }),
      fields: [
        create(FormFieldSchema, {
          fieldId: "groups",
          label: "Groups",
          kind: {
            case: "repeated",
            value: create(RepeatedFieldSchema, {
              addLabel: "Add section",
              minItems: 0,
              maxItems: 0, // unbounded
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

// ── scalar repeated field ──────────────────────────────────────────────────

describe("RepeatedField — scalar items (add / remove / reorder)", () => {
  it("seeds min_items rows and renders up/down/remove controls", async () => {
    render(
      <MeridianMuiProvider invoker={makeInvoker()}>
        <ViewRenderer view={formView(scalarPanel)} />
      </MeridianMuiProvider>,
    );
    // min_items=1 → one seeded row
    const removeButtons = await screen.findAllByRole("button", { name: /remove item/i });
    expect(removeButtons).toHaveLength(1);
    // up/down buttons are present for every row
    expect(screen.getAllByRole("button", { name: /move item up/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /move item down/i })).toHaveLength(1);
  });

  it("Add tag appends a new row", async () => {
    render(
      <MeridianMuiProvider invoker={makeInvoker()}>
        <ViewRenderer view={formView(scalarPanel)} />
      </MeridianMuiProvider>,
    );
    await screen.findByRole("button", { name: "Add tag" });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const removes = screen.getAllByRole("button", { name: /remove item/i });
    expect(removes).toHaveLength(2);
  });

  it("remove drops the correct row", async () => {
    render(
      <MeridianMuiProvider invoker={makeInvoker()}>
        <ViewRenderer view={formView(scalarPanel)} />
      </MeridianMuiProvider>,
    );
    // add a second row so we have 2
    await screen.findByRole("button", { name: "Add tag" });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(screen.getAllByRole("button", { name: /remove item/i })).toHaveLength(2);
    // remove the first row
    fireEvent.click(screen.getAllByRole("button", { name: /remove item/i })[0]);
    expect(screen.getAllByRole("button", { name: /remove item/i })).toHaveLength(1);
  });

  it("first row up is disabled; last row down is disabled", async () => {
    render(
      <MeridianMuiProvider invoker={makeInvoker()}>
        <ViewRenderer view={formView(scalarPanel)} />
      </MeridianMuiProvider>,
    );
    // add a second row so we have two
    await screen.findByRole("button", { name: "Add tag" });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const upBtns = screen.getAllByRole("button", { name: /move item up/i });
    const downBtns = screen.getAllByRole("button", { name: /move item down/i });
    expect((upBtns[0] as HTMLButtonElement).disabled).toBe(true);   // first row — can't move up
    expect((upBtns[1] as HTMLButtonElement).disabled).toBe(false);
    expect((downBtns[0] as HTMLButtonElement).disabled).toBe(false);
    expect((downBtns[1] as HTMLButtonElement).disabled).toBe(true); // last row — can't move down
  });

  it("move down swaps adjacent rows (round-trips the correct JSON)", async () => {
    const calls: unknown[] = [];
    render(
      <MeridianMuiProvider invoker={makeInvoker((req) => calls.push(req))}>
        <ViewRenderer view={formView(scalarPanel)} />
      </MeridianMuiProvider>,
    );
    // seed: 1 row. Add a second.
    await screen.findByRole("button", { name: "Add tag" });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    // type "alpha" in the first Tag input, "beta" in the second
    const inputs = screen.getAllByRole("textbox", { name: /tag/i });
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: "alpha" } });
    fireEvent.change(inputs[1], { target: { value: "beta" } });

    // move the first row down → order becomes [beta, alpha]
    const downBtns = screen.getAllByRole("button", { name: /move item down/i });
    fireEvent.click(downBtns[0]);

    // submit and check the serialized JSON
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(calls).toHaveLength(1);
    const submitted = calls[0] as { tags: unknown[] };
    expect(submitted.tags).toEqual(["beta", "alpha"]);
  });

  it("move up swaps adjacent rows", async () => {
    const calls: unknown[] = [];
    render(
      <MeridianMuiProvider invoker={makeInvoker((req) => calls.push(req))}>
        <ViewRenderer view={formView(scalarPanel)} />
      </MeridianMuiProvider>,
    );
    await screen.findByRole("button", { name: "Add tag" });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    const inputs = screen.getAllByRole("textbox", { name: /tag/i });
    fireEvent.change(inputs[0], { target: { value: "first" } });
    fireEvent.change(inputs[1], { target: { value: "second" } });

    // move the second row up → order becomes [second, first]
    const upBtns = screen.getAllByRole("button", { name: /move item up/i });
    fireEvent.click(upBtns[1]);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(calls).toHaveLength(1);
    expect((calls[0] as { tags: unknown[] }).tags).toEqual(["second", "first"]);
  });

  it("controls are hidden when form is READONLY (disabled)", async () => {
    const readonlyPanel = create(PanelDescriptorSchema, {
      panelId: "tags-readonly",
      title: "Tags",
      body: {
        case: "form",
        value: create(FormPanelSchema, {
          mode: FormMode.READONLY,
          itemNoun: "item",
          fields: [
            create(FormFieldSchema, {
              fieldId: "tags",
              label: "Tags",
              kind: {
                case: "repeated",
                value: create(RepeatedFieldSchema, {
                  addLabel: "Add tag",
                  minItems: 1,
                  element: {
                    case: "scalar",
                    value: create(FormFieldSchema, {
                      fieldId: "tag",
                      label: "Tag",
                      kind: { case: "text", value: create(TextInputSchema, { defaultValue: "existing" }) },
                    }),
                  },
                }),
              },
            }),
          ],
        }),
      },
    });
    render(
      <MeridianMuiProvider invoker={makeInvoker()}>
        <ViewRenderer view={formView(readonlyPanel)} />
      </MeridianMuiProvider>,
    );
    await screen.findAllByText("Tags");
    expect(screen.queryByRole("button", { name: "Add tag" })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove item/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move item up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /move item down/i })).toBeNull();
  });
});

// ── nested RepeatedField (nav.groups round-trip) ──────────────────────────

describe("RepeatedField — nav.groups shape (nested object + child RepeatedField)", () => {
  it("renders add-section and add-kind buttons", async () => {
    render(
      <MeridianMuiProvider invoker={makeInvoker()}>
        <ViewRenderer view={formView(navGroupsPanel)} />
      </MeridianMuiProvider>,
    );
    await screen.findByRole("button", { name: "Add section" });
    // add one section so we can see Add kind
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    await screen.findByRole("button", { name: "Add kind" });
  });

  it("reorders sections and round-trips to the expected JSON", async () => {
    const calls: unknown[] = [];
    render(
      <MeridianMuiProvider invoker={makeInvoker((req) => calls.push(req))}>
        <ViewRenderer view={formView(navGroupsPanel)} />
      </MeridianMuiProvider>,
    );
    await screen.findByRole("button", { name: "Add section" });

    // add two sections
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));

    // fill in the label fields: "Alpha" for the first, "Beta" for the second
    const labelInputs = screen.getAllByRole("textbox", { name: /label/i });
    expect(labelInputs.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(labelInputs[0], { target: { value: "Alpha" } });
    fireEvent.change(labelInputs[1], { target: { value: "Beta" } });

    // move the first section down → [Beta, Alpha]
    const downBtns = screen.getAllByRole("button", { name: /move item down/i });
    // The first section-level down button (groups list, index 0)
    fireEvent.click(downBtns[0]);

    // submit and check the groups array
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(calls).toHaveLength(1);
    const submitted = calls[0] as { groups: Array<{ label: string; kinds: unknown[] }> };
    expect(submitted.groups[0].label).toBe("Beta");
    expect(submitted.groups[1].label).toBe("Alpha");
  });

  it("adds a kind inside a section and round-trips to the expected JSON", async () => {
    const calls: unknown[] = [];
    render(
      <MeridianMuiProvider invoker={makeInvoker((req) => calls.push(req))}>
        <ViewRenderer view={formView(navGroupsPanel)} />
      </MeridianMuiProvider>,
    );
    await screen.findByRole("button", { name: "Add section" });
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));

    // fill in label
    const labelInputs = screen.getAllByRole("textbox", { name: /label/i });
    fireEvent.change(labelInputs[0], { target: { value: "Main" } });

    // add a kind
    fireEvent.click(screen.getByRole("button", { name: "Add kind" }));
    const kindInputs = screen.getAllByRole("textbox", { name: /kind/i });
    fireEvent.change(kindInputs[0], { target: { value: "products" } });

    // submit
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(calls).toHaveLength(1);
    const submitted = calls[0] as { groups: Array<{ label: string; kinds: string[] }> };
    expect(submitted.groups).toHaveLength(1);
    expect(submitted.groups[0].label).toBe("Main");
    expect(submitted.groups[0].kinds).toEqual(["products"]);
  });
});
