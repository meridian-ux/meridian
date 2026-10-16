// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { GrammarPanelSchema } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import {
  PanelDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { GrammarHandle } from "@savvifi/meridian-schemas/uiview";

import { renderPanel } from "../src/uiview/renderer.js";

const context = {
  currentResourcePath: null,
  uiIdentity: null,
  selectedRow: null,
  formValues: {},
};

const wasm = {
  renderTable: () => [],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: (_bytes: Uint8Array, context: { signals?: Record<string, unknown> }) =>
    context.signals?.brush === undefined ? {} : { range: context.signals.brush },
  renderTablePanel: () => [],
  formatLroMetadata: () => "",
};

describe("GrammarPanel signal bindings", () => {
  it("rejects a failed signal request before invoking and shows a safe error", async () => {
    const descriptor = create(PanelDescriptorSchema, {
      body: { case: "grammar", value: create(GrammarPanelSchema, {
        language: 5, source: '{"mark":"point"}',
        populate: { service: "metrics.Metrics", method: "ByRange", bindings: [
          { requestField: "range", source: { case: "signal", value: "brush" } },
        ] },
      }) },
    });
    let callback: ((value: unknown) => void) | undefined;
    const calls: object[] = [];
    const root = document.createElement("div");
    await renderPanel({
      wasm: { ...wasm, buildRequest: () => { throw new Error("private payload"); } },
      root, descriptor, context,
      invoker: { invoke: async (_s, _m, request) => { calls.push(request); return {}; } },
      renderGrammar: () => ({ element: document.createElement("div"), getSignal: () => [1, 4],
        onSignal: (_name, handler) => { callback = handler; } }),
    });
    callback?.([1, 4]);
    await Promise.resolve();
    expect(calls).toHaveLength(0);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("Signal request failed.");
    expect(root.textContent).not.toContain("private payload");
  });

  it("keeps the initial call inert and invokes through the signal handle", async () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "signal-chart",
      title: "Signal chart",
      body: {
        case: "grammar",
        value: create(GrammarPanelSchema, {
          language: 5,
          source: '{"mark":"point"}',
          populate: {
            service: "metrics.Metrics",
            method: "ByRange",
            bindings: [{ requestField: "range", source: { case: "signal", value: "brush" } }],
          },
        }),
      },
    });
    const calls: object[] = [];
    let onBrush: ((value: unknown) => void) | undefined;
    const root = document.createElement("div");
    const handle: GrammarHandle = {
      element: document.createElement("div"),
      getSignal: () => [1, 4],
      onSignal: (name, callback) => {
        expect(name).toBe("brush");
        onBrush = callback;
      },
    };

    await renderPanel({
      wasm,
      root,
      descriptor,
      context,
      invoker: { invoke: async (_service, _method, request) => { calls.push(request); return {}; } },
      renderGrammar: () => handle,
    });
    expect(calls).toHaveLength(0);
    onBrush?.([1, 4]);
    await Promise.resolve();
    expect(calls).toEqual([{ range: [1, 4] }]);
  });
});
