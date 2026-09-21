import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { StreamPanelSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { MeridianProvider, PanelRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { muiKit } from "../src/mui_kit.js";

afterEach(cleanup);

describe("MUI StreamPanel", () => {
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
