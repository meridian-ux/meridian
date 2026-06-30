// Cross-shape conformance for the React renderer: every canonical PanelDescriptor
// fixture must render without crashing, and the reference htmlKit must cover the
// shapes it claims (table/prompt/lro) while falling back — by design — for the
// richer shapes it omits (gallery/llmPrompt). This is the React-side seed of the
// crank multi-renderer conformance gate (COORDINATION §14): the same FIXTURES
// feed every renderer's conformance test.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PanelDescriptor } from "@meridian/proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@meridian/core/uiview";

import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider, type ReactAdhocFactory } from "../src/provider.js";
import { FIXTURES } from "./fixtures.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

function render(
  descriptor: PanelDescriptor,
  adhoc: Record<string, ReactAdhocFactory> = {},
): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit: htmlKit, adhoc },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}

function isFallback(html: string): boolean {
  return html.includes("unsupported panel shape") || html.includes("empty panel");
}

// htmlKit (the reference kit) implements these shapes; gallery/llmPrompt fall
// back by design (a richer kit like mui-kit would implement them).
const HTMLKIT_IMPLEMENTS = new Set(["table", "prompt", "lro"]);

describe("web-react conformance over the canonical fixtures (htmlKit)", () => {
  for (const fx of FIXTURES) {
    it(`renders the ${fx.name} shape without crashing and shows its title`, () => {
      const html = render(fx.descriptor);
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain(fx.descriptor.title);
    });
  }

  it("covers every shape htmlKit implements (no fallback for those)", () => {
    for (const fx of FIXTURES) {
      if (!HTMLKIT_IMPLEMENTS.has(fx.shape)) continue;
      expect(isFallback(render(fx.descriptor)), `${fx.name} must render via htmlKit`).toBe(
        false,
      );
    }
  });

  it("renders an adhoc panel through a host-registered React factory", () => {
    const adhoc: Record<string, ReactAdhocFactory> = {
      "overview-dashboard": ({ descriptor }) =>
        createElement("div", { className: "custom-dash" }, descriptor.panelId),
    };
    const fx = FIXTURES.find((f) => f.name === "adhoc")!;
    const html = render(fx.descriptor, adhoc);
    expect(html).toContain("custom-dash");
    expect(html).not.toContain("unsupported panel shape");
  });
});
