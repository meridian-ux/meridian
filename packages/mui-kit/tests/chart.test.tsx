import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { ChartPanelSchema } from "@savvifi/meridian-proto-ts/proto/chart_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { PanelRenderer, MeridianProvider } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { muiKit } from "../src/mui_kit.js";

afterEach(cleanup);

function descriptor() {
  return create(PanelDescriptorSchema, {
    panelId: "requests",
    title: "Requests",
    body: {
      case: "chart",
      value: create(ChartPanelSchema, {
        chart: {
          mark: 3,
          title: "Requests by day",
          rowsField: "data.rows",
          x: { fieldName: "day", type: 1 },
          y: { fieldName: "requests", type: 2 },
          populate: create(RpcCallSchema, { service: "metrics", method: "daily" }),
        },
      }),
    },
  });
}

describe("MUI ChartPanel", () => {
  it("renders populated rows through the standalone MUI kit", async () => {
    const invoke = vi.fn(async () => ({ data: { rows: [{ day: "Mon", requests: 12 }] } }));
    const invoker: RpcInvoker = { invoke };

    render(
      <MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}}>
        <PanelRenderer descriptor={descriptor()} />
      </MeridianProvider>,
    );

    await waitFor(() => expect(screen.getByText("Mon")).toBeTruthy());
    expect(screen.getByText("12")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("metrics", "daily", {});
  });

  it("shows the readable empty state when the populate call fails", async () => {
    const invoker: RpcInvoker = { invoke: async () => { throw new Error("offline"); } };

    render(
      <MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}}>
        <PanelRenderer descriptor={descriptor()} />
      </MeridianProvider>,
    );

    await waitFor(() => expect(screen.getByText("Unable to load chart data.")).toBeTruthy());
  });
});
