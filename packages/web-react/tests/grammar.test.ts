// GrammarPanel across both reference kits — content negotiation + the
// degradation ladder, plus the interactive path. The renderGrammar seam (the
// surface's capability set) is tried first; on absent/null the kit degrades:
// markdown → native md→React, else `alt`, else the source in a labeled block.
// The wired path mounts the host's live node (for React the "handle" is the
// mounted node); the null path is the static snapshot. Both kits share the
// content_shapes GrammarContent, so one assertion set covers html + shadcn.

import { create } from "@bufbuild/protobuf";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GrammarPanelSchema } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import type { ComponentKit } from "../src/component_kit.js";
import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider, type MeridianGrammarResolver } from "../src/provider.js";
import { shadcnKit } from "../src/shadcn_kit.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

function render(kit: ComponentKit, descriptor: PanelDescriptor, renderGrammar?: MeridianGrammarResolver): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit, adhoc: {}, renderGrammar },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}

const grammar = (value: Parameters<typeof create<typeof GrammarPanelSchema>>[1]): PanelDescriptor =>
  create(PanelDescriptorSchema, {
    panelId: "g",
    title: "G",
    body: { case: "grammar", value: create(GrammarPanelSchema, value) },
  });

// GrammarLanguage: 1=MARKDOWN 2=MERMAID 5=VEGA_LITE
const markdown = grammar({ language: 1, source: "# Hello\n\n**bold** `code`\n\n- one\n- two" });
const mermaid = grammar({ language: 2, source: "graph TD; A-->B", alt: "flowchart A to B" });
const vegaLite = grammar({ language: 5, source: '{"mark":"bar","data":{"values":[1,2,3]}}' });
// interactive vega-lite: a named selection (param) — the interactivity contract.
const vegaInteractive = grammar({
  language: 5,
  source: '{"params":[{"name":"brush","select":"interval"}],"mark":"point"}',
  alt: "scatter with brush selection",
});

const kits: [string, ComponentKit][] = [
  ["htmlKit", htmlKit],
  ["shadcnKit", shadcnKit],
];

describe.each(kits)("GrammarPanel negotiation + ladder (%s)", (_name, kit) => {
  it("always emits the mount, language, and the source for host hydration", () => {
    const html = render(kit, mermaid);
    expect(html).toContain('data-grammar-language="mermaid"');
    // the source lives raw in a text/plain <script> so the host reads it back via
    // .textContent (a text/plain script is a raw-text element up to </script>).
    expect(html).toContain("graph TD; A-->B");
  });

  it("ladder 1: markdown with no resolver → native md→React", () => {
    const html = render(kit, markdown);
    expect(html).toContain("<h3>Hello</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
  });

  it("ladder 2: non-markdown, no resolver, `alt` set → shows alt", () => {
    expect(render(kit, mermaid)).toContain("flowchart A to B");
  });

  it("ladder 3: non-markdown, no resolver, no alt → source in a labeled block", () => {
    const html = render(kit, vegaLite);
    expect(html).toContain("vega-lite"); // the fallback label
    expect(html).toContain('"mark":"bar"');
  });
});

describe("GrammarPanel interactive path (wired renderGrammar)", () => {
  it("wired resolver mounts the host's live node (its output is displayed)", () => {
    const seen: string[] = [];
    const resolver: MeridianGrammarResolver = ({ language, source }) => {
      seen.push(language);
      return createElement("div", { className: "host-vega-view", "data-src": source });
    };
    const html = render(htmlKit, vegaInteractive, resolver);
    expect(seen).toEqual(["vega-lite"]);
    expect(html).toContain("host-vega-view"); // the live node is mounted
    expect(html).not.toContain('class="mer-grammar-fallback"'); // not degraded
  });

  it("null from resolver (surface can't render) → static snapshot down the ladder", () => {
    // returns null ⇒ degrade; vega-interactive has alt ⇒ ladder step 2.
    const html = render(htmlKit, vegaInteractive, () => null);
    expect(html).toContain("scatter with brush selection"); // alt (static)
    expect(html).not.toContain("host-vega-view");
  });
});
