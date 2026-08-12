// Cross-panel SELECTION: the pure binding helpers + the slot gate. A scope picker
// (plan-year dropdown) publishes into a view-scoped bag; sibling panels bind their
// populate to it (FieldBinding.selection_key) and whole slots gate on it
// (Slot.depends_on_selection_key). No jsdom here — the gate is a render-time branch
// (SSR-visible), and the request-building is pure (mirrors pagination.test.ts).

import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  type ViewDescriptor,
  ViewDescriptorSchema,
  ViewKind,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { ViewRenderer } from "../src/view_renderer.js";
import {
  buildBindingRequest,
  hasSelectionBindings,
  selectionDeps,
  type MeridianSelection,
} from "../src/pagination.js";

const call = (bindings: Parameters<typeof create<typeof RpcCallSchema>>[1]["bindings"]) =>
  create(RpcCallSchema, { service: "s", method: "m", bindings });

describe("buildBindingRequest", () => {
  it("sets a request field from the current value of a bound selection key", () => {
    const req = buildBindingRequest(
      call([{ requestField: "id", source: { case: "selectionKey", value: "selectedPlanYearId" } }]),
      { selectedPlanYearId: "1234" },
    );
    expect(req).toEqual({ id: "1234" });
  });

  it("OMITS the field when the bound selection key is unset (never sends empty)", () => {
    // An unset scope must not widen the query — the field must be absent, not "".
    expect(
      buildBindingRequest(
        call([{ requestField: "id", source: { case: "selectionKey", value: "selectedPlanYearId" } }]),
        {},
      ),
    ).toEqual({});
  });

  it("resolves a literal binding (projection constant-fold)", () => {
    expect(
      buildBindingRequest(
        call([{ requestField: "sponsorId", source: { case: "literal", value: "42" } }]),
        {},
      ),
    ).toEqual({ sponsorId: "42" });
  });

  it("skips non-populate sources (row_field / signal / context)", () => {
    expect(
      buildBindingRequest(
        call([
          { requestField: "a", source: { case: "rowField", value: "x" } },
          { requestField: "b", source: { case: "signal", value: "y" } },
        ]),
        {},
      ),
    ).toEqual({});
  });

  it("writes a dotted request_field as a nested path", () => {
    expect(
      buildBindingRequest(
        call([{ requestField: "filter.planYearId", source: { case: "selectionKey", value: "k" } }]),
        { k: "9" },
      ),
    ).toEqual({ filter: { planYearId: "9" } });
  });
});

describe("selectionDeps", () => {
  it("is a stable string over the bound keys' current values", () => {
    const c = call([{ requestField: "id", source: { case: "selectionKey", value: "k" } }]);
    expect(selectionDeps(c, { k: "1" })).toBe("k=1;");
    expect(selectionDeps(c, { k: "2" })).not.toBe(selectionDeps(c, { k: "1" }));
  });

  it('is "" for a call with no selection bindings — so unbound panels never refetch', () => {
    expect(selectionDeps(call([{ requestField: "sponsorId", source: { case: "literal", value: "42" } }]), {})).toBe("");
    expect(selectionDeps(undefined, { k: "1" })).toBe("");
  });
});

describe("hasSelectionBindings", () => {
  it("is true iff a call binds at least one selection key", () => {
    expect(hasSelectionBindings(call([{ requestField: "id", source: { case: "selectionKey", value: "k" } }]))).toBe(true);
    expect(hasSelectionBindings(call([{ requestField: "id", source: { case: "literal", value: "1" } }]))).toBe(false);
    expect(hasSelectionBindings(undefined)).toBe(false);
  });
});

// --- The slot gate (SSR render-time branch) ---

const invoker: RpcInvoker = { invoke: async () => ({}) };
const adhoc = { "the-panel": () => createElement("div", { className: "the-panel" }, "PANEL BODY") };

function gatedView(): ViewDescriptor {
  return create(ViewDescriptorSchema, {
    id: "v",
    title: "Detail",
    kind: ViewKind.DETAIL,
    layout: { mode: { case: "stacked", value: {} } },
    slots: [
      {
        id: "overview",
        role: "configuration",
        position: 10,
        title: "Overview",
        dependsOnSelectionKey: "selectedPlanYearId",
        dependsOnPlaceholder: "Select a plan year to view this section.",
        panel: create(PanelDescriptorSchema, {
          panelId: "p",
          title: "",
          body: { case: "adhoc", value: { handlerId: "the-panel" } },
        }),
      },
    ],
  });
}

function renderWith(sel: MeridianSelection): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit: htmlKit, adhoc } as never,
      createElement(ViewRenderer, { view: gatedView(), selection: sel }),
    ),
  );
}

const bag = (values: Record<string, string>): MeridianSelection => ({ values, set: () => {} });

describe("Slot.depends_on_selection_key gate", () => {
  it("draws the placeholder and NOT the panel while the key is unset", () => {
    const html = renderWith(bag({}));
    expect(html).toContain('data-awaiting-selection="selectedPlanYearId"');
    expect(html).toContain("Select a plan year to view this section.");
    // The panel subtree must not mount (no scope-less fetch).
    expect(html).not.toContain("PANEL BODY");
  });

  it("renders the panel once the key has a value", () => {
    const html = renderWith(bag({ selectedPlanYearId: "2026" }));
    expect(html).toContain("PANEL BODY");
    expect(html).not.toContain("data-awaiting-selection");
  });

  it("treats an empty-string value as unset (truthiness, not !== undefined)", () => {
    // The original bug: clearing to "" / null re-opened the gate and fired the
    // scope-less query. Empty string must keep the gate CLOSED.
    const html = renderWith(bag({ selectedPlanYearId: "" }));
    expect(html).toContain("data-awaiting-selection");
    expect(html).not.toContain("PANEL BODY");
  });
});
