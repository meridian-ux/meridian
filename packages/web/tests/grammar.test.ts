// @vitest-environment jsdom
//
// GrammarPanel over the web-components renderer: content negotiation + the
// degradation ladder. A wired renderGrammar (the surface's capability set) is
// tried first; on absent/null the renderer degrades: markdown → native md→DOM,
// else `alt`, else the source in a labeled code block. Never blank.

import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import { markdownGrammarFixture, mermaidGrammarFixture, vegaGrammarFixture } from "./fixtures.js";

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

async function draw(
  descriptor: Parameters<typeof renderPanel>[0]["descriptor"],
  renderGrammar?: (o: { language: string; source: string; data?: unknown }) => HTMLElement | undefined,
) {
  const root = document.createElement("div");
  await renderPanel({ wasm: noWasm, root, descriptor, invoker, context: CTX, renderGrammar });
  return root;
}

describe("GrammarPanel (web-components) — negotiation + degradation ladder", () => {
  it("always emits the mount, language, and the source for host hydration", async () => {
    const root = await draw(mermaidGrammarFixture);
    const g = root.querySelector(".mer-grammar") as HTMLElement;
    expect(g.dataset.grammarLanguage).toBe("mermaid");
    expect(root.querySelector("script.mer-grammar-source")?.textContent).toBe("graph TD; A-->B");
  });

  it("wired renderGrammar (surface can display) mounts the host output", async () => {
    const seen: string[] = [];
    const root = await draw(mermaidGrammarFixture, ({ language, source }) => {
      seen.push(`${language}:${source}`);
      const svg = document.createElement("div");
      svg.className = "host-mermaid-svg";
      return svg;
    });
    expect(seen).toEqual(["mermaid:graph TD; A-->B"]);
    expect(root.querySelector(".host-mermaid-svg")).toBeTruthy();
  });

  it("ladder 1: markdown with no renderer → native md→DOM (no library)", async () => {
    const root = await draw(markdownGrammarFixture);
    const md = root.querySelector(".mer-grammar-markdown") as HTMLElement;
    expect(md.querySelector("h3")?.textContent).toBe("Hello");
    expect(md.querySelector("strong")?.textContent).toBe("bold");
    expect(md.querySelector("code")?.textContent).toBe("code");
    expect(md.querySelectorAll("li").length).toBe(2);
  });

  it("ladder 2: non-markdown with no renderer but `alt` set → shows alt", async () => {
    const root = await draw(mermaidGrammarFixture); // has alt
    expect(root.querySelector(".mer-grammar-alt")?.textContent).toBe("flowchart: A to B");
    expect(root.querySelector(".mer-grammar-fallback")).toBeNull();
  });

  it("ladder 3: non-markdown, no renderer, no alt → source in a labeled code block", async () => {
    const root = await draw(vegaGrammarFixture); // vega-lite, no alt
    const fb = root.querySelector(".mer-grammar-fallback") as HTMLElement;
    expect(fb).toBeTruthy();
    expect(fb.querySelector("figcaption")?.textContent).toBe("vega-lite");
    expect(fb.querySelector("code")?.textContent).toContain('"mark":"bar"');
  });

  it("null from renderGrammar (surface can't display this language) → degrades", async () => {
    const root = await draw(vegaGrammarFixture, () => undefined); // returns nothing
    expect(root.querySelector(".mer-grammar-fallback")).toBeTruthy(); // fell through to source
  });
});
