// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ActionPlacement, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { AdmissionDenial, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { ViewRenderer } from "@savvifi/meridian-web-react";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

const view = create(ViewDescriptorSchema, {
  id: "mui-admission-view",
  kind: ViewKind.LIST,
  layout: { mode: { case: "stacked", value: {} } },
  actions: [{
    id: "delete",
    label: "Delete",
    placement: ActionPlacement.HEADER,
    call: create(RpcCallSchema, { service: "demo.Orders", method: "DeleteOrder" }),
  }],
});

describe("MUI admission boundary", () => {
  it("blocks a header mutation before the invoker", () => {
    const calls: string[] = [];
    const denials: AdmissionDenial[] = [];
    const invoker: RpcInvoker = {
      invoke: async (_service, method) => {
        calls.push(method);
        return {};
      },
    };
    render(
      <MeridianMuiProvider invoker={invoker} admission={{ onDenied: (denial) => denials.push(denial) }}>
        <ViewRenderer view={view} />
      </MeridianMuiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(calls).toEqual([]);
    expect(denials).toMatchObject([{ tier: "mutation", service: "demo.Orders", method: "DeleteOrder" }]);
  });
});
