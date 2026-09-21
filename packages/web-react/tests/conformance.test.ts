// Cross-shape conformance for the React renderer: every canonical PanelDescriptor
// fixture must render without crashing, and the reference htmlKit must cover the
// shapes it claims (table/prompt/lro) while falling back — by design — for the
// richer shapes it omits (gallery/llmPrompt). This is the React-side seed of the
// crank multi-renderer conformance gate (COORDINATION §14): the same FIXTURES
// feed every renderer's conformance test.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import coverageManifest from "../../../schemas/conformance/coverage.json";

import type { ComponentKit } from "../src/component_kit.js";
import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider, type ReactAdhocFactory } from "../src/provider.js";
import { shadcnKit } from "../src/shadcn_kit.js";
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

// htmlKit (the reference kit) implements every canonical shape except
// llmPrompt and host-registered adhoc content. Its implementations may still
// be semantic degradations (for example, Chart and Terminal), but they must
// not disappear into the generic unsupported-shape fallback.
const HTMLKIT_IMPLEMENTS = new Set([
  "table",
  "prompt",
  "lro",
  "form",
  "gallery",
  "terminal",
  "grammar",
  "detail_header",
  "record_card",
  "resource_cards",
  "chart",
  "steps",
  "media",
  "stream",
  "choice",
  "snippet",
  "action",
  "connectFlow",
  "copyValue",
  "catalog",
  "stat",
]);

function toFixtureShape(arm: string): string {
  return arm.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

describe("web-react conformance over the canonical fixtures (htmlKit)", () => {
  it("has exactly one fixture for every canonical panel arm", () => {
    const canonical = Object.keys(coverageManifest.arms).map(toFixtureShape).sort();
    const fixtures = FIXTURES
      .filter((fixture) => fixture.shape !== "(unset)")
      .map((fixture) => toFixtureShape(fixture.shape))
      .sort();
    expect(new Set(fixtures).size, "fixture corpus must not duplicate an arm").toBe(fixtures.length);
    expect(fixtures).toEqual(canonical);
  });

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

// ── Swap B: the same fixtures through a SECOND kit (shadcnKit) ──────────────
// Swapping the ComponentKit changes the look + concrete components, NOT the
// PanelRenderer dispatch. This is the React-side proof of Swap B, and the
// structural template the mui-kit (wrapping a host's internal MUI component library) follows.
function renderWith(
  kit: ComponentKit,
  descriptor: PanelDescriptor,
): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit, adhoc: {} },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}

describe("Swap B — shadcnKit renders the same fixtures, different look", () => {
  for (const fx of FIXTURES) {
    it(`shadcnKit renders the ${fx.name} shape and shows its title`, () => {
      const html = renderWith(shadcnKit, fx.descriptor);
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain(fx.descriptor.title);
    });
  }

  // shadcnKit implements the same shape set as htmlKit (table/prompt/lro).
  it("covers every shape shadcnKit implements (no fallback for those)", () => {
    for (const fx of FIXTURES) {
      if (!HTMLKIT_IMPLEMENTS.has(fx.shape)) continue;
      expect(
        isFallback(renderWith(shadcnKit, fx.descriptor)),
        `${fx.name} must render via shadcnKit`,
      ).toBe(false);
    }
  });

  it("is a real swap — identical dispatch, different markup vs htmlKit", () => {
    const table = FIXTURES.find((f) => f.shape === "table")!;
    const htmlOut = renderWith(htmlKit, table.descriptor);
    const shadcnOut = renderWith(shadcnKit, table.descriptor);
    expect(htmlOut).toContain("mer-table"); // htmlKit's own classes
    expect(shadcnOut).toContain("caption-bottom"); // shadcn/Tailwind classes
    expect(shadcnOut).not.toContain("mer-table");
  });
});
