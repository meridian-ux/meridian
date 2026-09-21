// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { renderPanel } from "../src/uiview/renderer.js";

const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const wasm = {
  renderTable: () => [], buildPopulateRequest: () => ({}), readPath: () => null,
  buildRequest: () => ({}), renderTablePanel: () => [], formatLroMetadata: () => "",
};
const descriptor = create(PanelDescriptorSchema, {
  panelId: "latency", title: "Latency", body: { case: "chart", value: {
    chart: { mark: 3, x: { fieldName: "name", type: 3 }, y: { fieldName: "value", type: 2 },
      populate: { service: "Metrics", method: "List" }, title: "Latency by service" },
  } },
});

describe("ChartPanel (web-components)", () => {
  it("uses the host renderer and passes populated data", async () => {
    const root = document.createElement("div");
    let seen: object | undefined;
    await renderPanel({ wasm, root, descriptor, context, invoker: {
      invoke: async () => ({ rows: [{ name: "api", value: 42 }] }),
    }, renderChart: ({ spec, data }) => {
      seen = data;
      const node = document.createElement("div"); node.className = "host-chart";
      expect(spec.title).toBe("Latency by service"); return node;
    } });
    expect(seen).toEqual({ rows: [{ name: "api", value: 42 }] });
    expect(root.querySelector(".host-chart")).toBeTruthy();
  });

  it("degrades to an accessible data table without a host renderer", async () => {
    const root = document.createElement("div");
    await renderPanel({ wasm, root, descriptor, context, invoker: {
      invoke: async () => ({ rows: [{ name: "api", value: 42 }] }),
    } });
    expect(root.querySelector(".mer-chart-title")?.textContent).toBe("Latency by service");
    expect(root.querySelector(".mer-chart-summary")?.textContent).toBe("bar of value by name");
    expect(root.querySelector(".mer-chart-data")?.textContent).toContain("api");
  });
});
