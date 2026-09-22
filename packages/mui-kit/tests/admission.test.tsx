// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.title).toContain("not permitted");
    fireEvent.click(button);

    expect(calls).toEqual([]);
    expect(denials).toMatchObject([{ tier: "mutation", service: "demo.Orders", method: "DeleteOrder" }]);
  });
  it("shows escaped failures, retries the same request, and prevents duplicate mutations", async () => {
    const calls: unknown[] = [];
    let finish: (() => void) | undefined;
    const invoker: RpcInvoker = { invoke: async (service, method, request) => {
      calls.push([service, method, request]);
      if (calls.length === 1) throw new Error("<b>Unavailable</b>");
      await new Promise<void>(resolve => { finish = resolve; });
      return {};
    } };
    render(<MeridianMuiProvider invoker={invoker} admission={{ mutations: ["*"] }}><ViewRenderer view={view} /></MeridianMuiProvider>);
    const button = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("<b>Unavailable</b>");
    expect(alert.querySelector("b")).toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(calls).toEqual(Array(2).fill(["demo.Orders", "DeleteOrder", {}]));
    expect(button.hasAttribute("disabled")).toBe(true);
    finish!();
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
