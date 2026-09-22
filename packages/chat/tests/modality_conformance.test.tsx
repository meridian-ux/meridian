import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlockView } from "../src/render_react.js";
import { renderBlockInner } from "../src/render_html.js";
import type { Block } from "../src/wire.js";

const coverage = JSON.parse(
  readFileSync(new URL("../../../schemas/conformance/coverage.json", import.meta.url), "utf8"),
).modalities.conversation.arms as Record<string, {
  renderers: Record<string, { status: string; reason?: string }>;
}>;

const cases: Record<string, { block: Block; marker: string }> = {
  markdown: { block: { markdown: { text: "markdown sentinel" } }, marker: "markdown sentinel" },
  context: { block: { context: { text: "context sentinel" } }, marker: "context sentinel" },
  tool: { block: { tool: { name: "tool sentinel", state: "OK" } }, marker: "tool sentinel" },
  list: { block: { list: { items: [{ title: "list sentinel" }] } }, marker: "list sentinel" },
  fields: { block: { fields: { fields: [{ key: "field key", value: "field sentinel" }] } }, marker: "field sentinel" },
  code: { block: { code: { text: "code sentinel" } }, marker: "code sentinel" },
  divider: { block: { divider: {} }, marker: 'class="div"' },
  table: {
    block: { table: { columns: [{ key: "value" }], rows: [{ cells: { value: "table sentinel" } }] } },
    marker: "table sentinel",
  },
  view: {
    block: { view: { id: "nested-view", title: "Nested view", layout: { stacked: {} }, slots: [] } },
    marker: "host-rendered view",
  },
};

describe("conversation modality coverage", () => {
  it("matches every Block.kind arm to its declared HTML and React realization", () => {
    expect(Object.keys(coverage).sort()).toEqual(Object.keys(cases).sort());

    for (const [arm, { block, marker }] of Object.entries(cases)) {
      const htmlStatus = coverage[arm].renderers["chat-html"];
      const reactStatus = coverage[arm].renderers["chat-react"];
      expect(htmlStatus, `${arm} needs an HTML coverage declaration`).toBeDefined();
      expect(reactStatus, `${arm} needs a React coverage declaration`).toBeDefined();

      const html = renderBlockInner(block);
      if (htmlStatus.status === "renders") expect(html, arm).toContain(marker);
      else if (htmlStatus.status === "not-applicable") expect(html, arm).toBe("");
      else throw new Error(`unexpected chat-html status for ${arm}: ${htmlStatus.status}`);

      const react = renderToStaticMarkup(createElement(BlockView, {
        block,
        renderView: () => createElement("span", null, marker),
      }));
      if (reactStatus.status === "renders" || reactStatus.status === "separate-entrypoint") {
        expect(react, arm).toContain(marker);
      } else {
        throw new Error(`unexpected chat-react status for ${arm}: ${reactStatus.status}`);
      }
      if (reactStatus.reason) expect(reactStatus.reason.length).toBeGreaterThan(0);
    }
  });
});
