// @vitest-environment jsdom
//
// StatPanel over the web-components renderer — the KPI tile. Delta/trend/format
// come from the SHARED computeStat (identical to the react kits + tui): the
// delta/trend is COMPUTED, never author-marked; semantic color only when
// higher_is_better is set; a hand-drawn SVG sparkline (no chart library).

import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import { statFixture } from "./fixtures.js";

const noWasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: () => ({}),
  renderTablePanel: () => [] as RenderedRow[],
  formatLroMetadata: () => "",
};
const CTX = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const invoker = { invoke: async () => ({}) };

describe("StatPanel (web-components) — computed delta + sparkline", () => {
  it("renders value, computed delta with semantic color, and an SVG sparkline", async () => {
    const root = document.createElement("div");
    await renderPanel({ wasm: noWasm, root, descriptor: statFixture, invoker, context: CTX });

    expect(root.querySelector(".mer-stat-label")?.textContent).toBe("Churn rate");
    expect(root.querySelector(".mer-stat-value")?.textContent).toBe("5.2%"); // PERCENT format

    const delta = root.querySelector(".mer-stat-delta") as HTMLElement;
    expect(delta.textContent).toContain("↑"); // rising
    expect(delta.textContent).toContain("+1.2%"); // computed 5.2 − 4.0
    expect(delta.dataset.semantics).toBe("bad"); // churn up (higher_is_better=false) = bad

    // hand-drawn inline SVG sparkline (no chart lib).
    const poly = root.querySelector("svg.mer-stat-spark polyline");
    expect(poly).toBeTruthy();
    expect((poly as SVGElement).getAttribute("points")?.split(" ").length).toBe(4);
  });
});
