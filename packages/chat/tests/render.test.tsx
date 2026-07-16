import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { renderBlockInner } from "../src/render_html.js";
import { Conversation } from "../src/index.js";
import type { Block } from "../src/wire.js";

describe("renderBlockInner (vanilla HTML)", () => {
  it("renders a tool block with an ok dot + summary", () => {
    const b: Block = {
      blockId: "t",
      role: "assistant",
      tool: { name: "forge·list", state: "OK", summary: "3 repos" },
    };
    const html = renderBlockInner(b);
    expect(html).toContain("forge·list");
    expect(html).toContain("dot ok");
    expect(html).toContain("3 repos");
  });

  it("escapes markdown text and applies **bold**", () => {
    const html = renderBlockInner({ blockId: "m", markdown: { text: "a <b> **x**" } });
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("<strong>x</strong>");
  });

  it("renders a table block", () => {
    const html = renderBlockInner({
      blockId: "tb",
      table: {
        title: "Repos",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ cells: { name: "aion/web" } }],
      },
    });
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("aion/web");
  });
});

describe("<Conversation> (react)", () => {
  it("renders the wrapper, empty state, and composer", () => {
    // createElement (not JSX) so the test runs under both the pnpm (automatic
    // JSX runtime) and Bazel/rules_vite (classic runtime) harnesses.
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).toContain("meridian-conversation");
    expect(html).toContain("asst-input");
    expect(html).toContain("connected tools");
  });
});
