// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ChartMark, ChartPanelSchema, EncodingType } from "@savvifi/meridian-proto-ts/proto/chart_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { StepsPanelSchema } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianSelectionContext } from "../src/pagination.js";
import { MeridianProvider } from "../src/provider.js";
import { shadcnKit } from "../src/shadcn_kit.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const emptyInvoker: RpcInvoker = { invoke: async () => ({}) };
const staticChart = create(PanelDescriptorSchema, {
  panelId: "requests",
  title: "Requests",
  body: { case: "chart", value: create(ChartPanelSchema, { chart: {
    mark: ChartMark.BAR,
    title: "Requests by day",
    x: { fieldName: "day", type: EncodingType.TEMPORAL },
    y: { fieldName: "requests", type: EncodingType.QUANTITATIVE },
  } }) },
});

describe("ChartPanel static dispatch", () => {
  it("dispatches the portable chart shape through htmlKit", () => {
    const html = renderToStaticMarkup(createElement(
      MeridianProvider,
      { invoker: emptyInvoker, kit: htmlKit, adhoc: {} },
      createElement(PanelRenderer, { descriptor: staticChart }),
    ));
    expect(html).toContain('class="mer-chart"');
    expect(html).toContain("Requests by day");
    expect(html).toContain("bar of requests by day");
  });

  it("dispatches the portable chart shape through shadcnKit", () => {
    const html = renderToStaticMarkup(createElement(
      MeridianProvider,
      { invoker: emptyInvoker, kit: shadcnKit, adhoc: {} },
      createElement(PanelRenderer, { descriptor: staticChart }),
    ));
    expect(html).toContain("Requests by day");
    expect(html).toContain("bar of requests by day");
  });

  it("renders computed numbered steps through shadcnKit", () => {
    const steps = create(PanelDescriptorSchema, {
      panelId: "onboarding",
      body: { case: "steps", value: create(StepsPanelSchema, {
        intro: "Get started",
        steps: [{ label: "Connect account", actor: "Admin", detail: "Authorize access." }],
        outro: "You are ready.",
      }) },
    });
    const html = renderToStaticMarkup(createElement(
      MeridianProvider,
      { invoker: emptyInvoker, kit: shadcnKit, adhoc: {} },
      createElement(PanelRenderer, { descriptor: steps }),
    ));
    expect(html).toContain("<ol");
    expect(html).toContain("1.");
    expect(html).toContain("Connect account");
    expect(html).toContain("Authorize access.");
    expect(html).toContain("You are ready.");
  });
});

const descriptor = create(PanelDescriptorSchema, {
  panelId: "latency",
  title: "Latency",
  body: { case: "chart", value: create(ChartPanelSchema, { chart: {
    mark: ChartMark.BAR,
    title: "Latency by service",
    x: { fieldName: "service.name", type: EncodingType.NOMINAL },
    y: { fieldName: "p95", type: EncodingType.QUANTITATIVE },
    series: { fieldName: "region", type: EncodingType.NOMINAL },
    populate: {
      service: "demo.Metrics",
      method: "List",
      bindings: [{ requestField: "environment", source: { case: "selectionKey", value: "scope" } }],
    },
    rowsField: "data.points",
  } }) },
});

describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s populated chart", (_name, kit) => {
  async function mount(invoke: RpcInvoker["invoke"]) {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(
      MeridianProvider,
      { kit, adhoc: {}, invoker: { invoke } },
      createElement(
        MeridianSelectionContext.Provider,
        { value: { values: { scope: "production" }, set: () => {} } },
        createElement(PanelRenderer, { descriptor }),
      ),
    )));
    return { container, close: () => act(async () => root.unmount()) };
  }

  it("loads nested rows with selection bindings and preserves field order", async () => {
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ data: { points: [
      { service: { name: "api" }, p95: 42, region: "us-east" },
      { service: { name: "worker" }, p95: 84, region: "us-west" },
    ] } }));
    const view = await mount(invoke);
    try {
      expect(invoke).toHaveBeenCalledWith("demo.Metrics", "List", { environment: "production" });
      expect(view.container.querySelector("figure")?.getAttribute("data-mark")).toBe("bar");
      expect(Array.from(view.container.querySelectorAll("th"), cell => cell.textContent)).toEqual(["service.name", "p95", "region"]);
      expect(Array.from(view.container.querySelectorAll("tbody tr:first-child td"), cell => cell.textContent)).toEqual(["api", "42", "us-east"]);
      expect(view.container.querySelectorAll("tbody tr")).toHaveLength(2);
    } finally {
      await view.close();
    }
  });

  it("shows a bounded error without leaking transport details", async () => {
    const view = await mount(async () => { throw new Error("private upstream details"); });
    try {
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("Unable to load chart data.");
      expect(view.container.textContent).not.toContain("private upstream details");
      expect(view.container.querySelector("table")).toBeNull();
    } finally {
      await view.close();
    }
  });

  it("preserves pending and empty response states", async () => {
    let finish!: (value: object) => void;
    const pending = new Promise<object>((resolve) => { finish = resolve; });
    const view = await mount(async () => pending);
    try {
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe("Loading chart data…");
      await act(async () => finish({ data: { points: [] } }));
      expect(view.container.textContent).toContain("No chart data.");
      expect(view.container.querySelector('[role="status"]')).toBeNull();
    } finally {
      await view.close();
    }
  });
});
