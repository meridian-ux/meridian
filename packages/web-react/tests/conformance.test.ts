// @vitest-environment jsdom
// Canonical fixtures through both reference kits. Semantic snapshots catch body
// regressions, while the coverage manifest determines which arms may fall back.

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
import { normalizeMarkup } from "../../../schemas/conformance/normalize_dom.js";

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

function declaredRendered(kit: "html-kit" | "shadcn-kit"): Set<string> {
  return new Set(Object.entries(coverageManifest.arms)
    .filter(([, arm]) => arm.renderers[kit].status === "renders")
    .map(([name]) => toFixtureShape(name)));
}

function snapshotArm(descriptor: PanelDescriptor): string {
  return (descriptor.body.case || "unset").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

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
      expect(html).toContain(`data-panel="${fx.descriptor.panelId}"`);
      expect(html).toContain(`data-panel-shape="${fx.descriptor.body.case || "unset"}"`);
      expect(normalizeMarkup(html)).toMatchSnapshot(`html-kit/${snapshotArm(fx.descriptor)}`);
    });
  }

  it("covers every shape htmlKit implements (no fallback for those)", () => {
    for (const fx of FIXTURES) {
      if (!declaredRendered("html-kit").has(toFixtureShape(fx.shape))) continue;
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
      expect(html).toContain(`data-panel="${fx.descriptor.panelId}"`);
      expect(html).toContain(`data-panel-shape="${fx.descriptor.body.case || "unset"}"`);
      expect(normalizeMarkup(html)).toMatchSnapshot(`shadcn-kit/${snapshotArm(fx.descriptor)}`);
    });
  }

  it("covers every shape shadcnKit implements (no fallback for those)", () => {
    for (const fx of FIXTURES) {
      if (!declaredRendered("shadcn-kit").has(toFixtureShape(fx.shape))) continue;
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
