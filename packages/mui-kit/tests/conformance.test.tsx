// Canonical panel conformance through the MUI ComponentKit.
//
// The fixture descriptors are protobuf messages owned by the web-react
// conformance seed. Reusing those messages here makes this a cross-renderer
// check: adding or removing a panel arm changes the corpus every kit must
// consume, rather than creating another MUI-only fixture list.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PanelRenderer, MeridianProvider } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { normalizeMarkup } from "../../../schemas/conformance/normalize_dom.js";

const invoker = { invoke: async () => ({}) };

function renderFixture(fixture: (typeof FIXTURES)[number]): string {
  const panel = createElement(PanelRenderer, { descriptor: fixture.descriptor });
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      {
        invoker,
        kit: muiKit,
        adhoc: {
          "overview-dashboard": ({ descriptor }) =>
            createElement("div", { className: "mer-adhoc-test" }, descriptor.panelId),
        },
        children: panel,
      },
    ),
  );
}

describe("muiKit canonical panel conformance", () => {
  for (const fixture of FIXTURES) {
    it(`renders the ${fixture.name} fixture without crashing`, () => {
      const html = renderFixture(fixture);
      if (fixture.descriptor.body.case === "copyValue") {
        expect(normalizeMarkup(html)).toContain(fixture.descriptor.body.value.value!.value);
        expect(normalizeMarkup(html)).toContain(fixture.descriptor.body.value.value!.label);
      }
      expect(html.length).toBeGreaterThan(0);
      // Panel titles are not required to be repeated by every kit's shape
      // component (some use the descriptor only for the outer panel identity),
      // so the cross-renderer normalizers are the stable panel and body-arm markers.
      expect(html).toContain(`data-panel="${fixture.descriptor.panelId}"`);
      expect(html).toContain(`data-panel-shape="${fixture.descriptor.body.case || "unset"}"`);
      const arm = (fixture.descriptor.body.case || "unset").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      expect(normalizeMarkup(html)).toMatchSnapshot(`mui-kit/${arm}`);
    });
  }
});
