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
  buildRequest: () => ({}),
  renderTablePanel: () => [],
  formatLroMetadata: () => "",
};

describe("GrammarPanel signal bindings", () => {
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
