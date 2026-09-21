// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  ActionPlacement,
  ViewDescriptorSchema,
  ViewKind,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { AdmissionDenial, RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { ViewRenderer } from "../src/view_renderer.js";

function actionView() {
  return create(ViewDescriptorSchema, {
    id: "admission-view",
    kind: ViewKind.LIST,
    layout: { mode: { case: "stacked", value: {} } },
    actions: [{
      id: "delete",
      label: "Delete",
      placement: ActionPlacement.HEADER,
      call: create(RpcCallSchema, { service: "demo.Orders", method: "DeleteOrder" }),
    }],
  });
}

describe("React admission boundary", () => {
  it("denies view actions by default before reaching the invoker", async () => {
    const calls: string[] = [];
    const denials: AdmissionDenial[] = [];
    const invoker: RpcInvoker = {
      invoke: async (_service, method) => {
        calls.push(method);
        return {};
      },
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          MeridianProvider,
          { invoker, kit: htmlKit, adhoc: {}, admission: { onDenied: (denial) => denials.push(denial) } },
          createElement(ViewRenderer, { view: actionView() }),
        ),
      );
    });
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(calls).toEqual([]);
    expect(denials).toMatchObject([{ tier: "mutation", service: "demo.Orders", method: "DeleteOrder" }]);
    root.unmount();
  });

  it("allows an explicitly listed mutation", async () => {
    const calls: string[] = [];
    const invoker: RpcInvoker = {
      invoke: async (_service, method) => {
        calls.push(method);
        return {};
      },
    };
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          MeridianProvider,
          {
            invoker,
            kit: htmlKit,
            adhoc: {},
            admission: { mutations: ["demo.Orders/DeleteOrder"] },
          },
          createElement(ViewRenderer, { view: actionView() }),
        ),
      );
    });
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(calls).toEqual(["DeleteOrder"]);
    root.unmount();
  });
});
