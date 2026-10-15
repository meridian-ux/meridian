import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { StreamFrameSchema, StreamPanelSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { MeridianProvider, PanelRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { muiKit } from "../src/mui_kit.js";
import { MeridianStream } from "../src/components/stream.js";

afterEach(cleanup);

describe("MUI StreamPanel", () => {
  it("preserves the standalone panel-only component API without a provider", () => {
    render(<MeridianStream panel={create(StreamPanelSchema, { placeholder: "Standalone waiting" })} />);
    expect(screen.getByText("Standalone waiting")).toBeTruthy();
  });
  it("renders a bounded protobuf transcript through the shared kit contract", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "build-log", body: { case: "stream", value: create(StreamPanelSchema, { maxLines: 1, lineField: "event.message" }) },
    });
    const frames = ["older", "newest"].map(message => create(StreamFrameSchema, {
      dataJson: new TextEncoder().encode(JSON.stringify({ event: { message } })),
    }));
    const invoker: RpcInvoker = { invoke: async () => ({}) };
    const { rerender } = render(<MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}} streamSnapshots={{ "build-log": frames }}>
      <PanelRenderer descriptor={descriptor} />
    </MeridianProvider>);
    expect(screen.getByRole("log").textContent).toBe("newest");
    expect(screen.queryByText("older")).toBeNull();
    const next = create(StreamFrameSchema, { dataJson: new TextEncoder().encode(JSON.stringify({ event: { message: "updated" } })) });
    rerender(<MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}} streamSnapshots={{ "build-log": [next] }}>
      <PanelRenderer descriptor={descriptor} />
    </MeridianProvider>);
    expect(screen.getByRole("log").textContent).toBe("updated");
  });
  it("renders an accessible host-transport placeholder", () => {
    const invoker: RpcInvoker = { invoke: async () => ({}) };
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "build-log",
      title: "Build log",
      body: {
        case: "stream",
        value: create(StreamPanelSchema, { placeholder: "Waiting for build events...", itemNoun: "events" }),
      },
    });

    render(
      <MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}}>
        <PanelRenderer descriptor={descriptor} />
      </MeridianProvider>,
    );

    const placeholder = screen.getByText("Waiting for build events...");
    expect(placeholder).toBeTruthy();
    expect(placeholder.closest(".mer-stream")?.getAttribute("aria-live")).toBe("polite");
  });
});
