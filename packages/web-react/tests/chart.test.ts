import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { StepsPanelSchema } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";

import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };
const chart: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "requests",
  title: "Requests",
  body: {
    case: "chart",
    value: {
      chart: {
        mark: 3,
        title: "Requests by day",
        x: { fieldName: "day", type: 1 },
        y: { fieldName: "requests", type: 2 },
      },
    },
  },
});

describe("ChartPanel (React htmlKit)", () => {
  it("dispatches the portable chart shape through the kit", () => {
    const html = renderToStaticMarkup(
      createElement(
        MeridianProvider,
        { invoker, kit: htmlKit, adhoc: {} },
        createElement(PanelRenderer, { descriptor: chart }),
      ),
    );
    expect(html).toContain('class="mer-chart"');
    expect(html).toContain("Requests by day");
    expect(html).toContain("requests by day");
  });

  it("dispatches the portable chart shape through shadcnKit", () => {
    const html = renderToStaticMarkup(
      createElement(
        MeridianProvider,
        { invoker, kit: shadcnKit, adhoc: {} },
        createElement(PanelRenderer, { descriptor: chart }),
      ),
    );
    expect(html).toContain("Requests by day");
    expect(html).toContain("requests by day");
  });

  it("renders computed numbered steps through shadcnKit", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "onboarding",
      body: {
        case: "steps",
        value: create(StepsPanelSchema, {
          intro: "Get started",
          steps: [{ label: "Connect account", actor: "Admin", detail: "Authorize access." }],
          outro: "You are ready.",
        }),
      },
    });
    const html = renderToStaticMarkup(
      createElement(MeridianProvider, { invoker, kit: shadcnKit, adhoc: {} }, createElement(PanelRenderer, { descriptor })),
    );
    expect(html).toContain("<ol");
    expect(html).toContain("1.");
    expect(html).toContain("Connect account");
    expect(html).toContain("Authorize access.");
    expect(html).toContain("You are ready.");
  });
});
