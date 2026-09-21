// @vitest-environment jsdom
//
// Render conformance + the binary-boundary guard for the B1 rewrite. Each shape
// fixture is rendered through the real renderPanel into a jsdom container; a mock
// UiviewWasm stands in for the rust core and — crucially — `fromBinary`-decodes
// every Uint8Array the renderer hands it. If renderer.ts ever serializes a
// descriptor/sub-message incorrectly, fromBinary throws and the test fails, so
// this proves the toBinary boundary the way the real wasm (prost::decode) needs.

import { fromBinary } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { beforeAll, describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import { adhocFixture, tableFixture } from "./fixtures.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";

// A mock wasm that validates the binpb it receives (fromBinary throws on bad
// bytes) and returns canned data.
const CANNED_ROWS: RenderedRow[] = [
  { raw: { name: "Ada" }, cells: ["Ada", "ada@acme.dev"] },
  { raw: { name: "Linus" }, cells: ["Linus", "linus@acme.dev"] },
];

const mockWasm: UiviewWasm = {
  renderTable(descriptor) {
    fromBinary(PanelDescriptorSchema, descriptor); // throws if invalid
    return CANNED_ROWS;
  },
  buildPopulateRequest(descriptor) {
    fromBinary(PanelDescriptorSchema, descriptor);
    return {};
  },
  readPath: (_v, _p) => null,
  buildRequest(rpcCall) {
    fromBinary(RpcCallSchema, rpcCall);
    return {};
  },
  renderTablePanel(tablePanel) {
    fromBinary(TablePanelSchema, tablePanel);
    return CANNED_ROWS;
  },
  formatLroMetadata: (m) => JSON.stringify(m),
};

const EMPTY_CTX = {
  currentResourcePath: "users/1",
  uiIdentity: null,
  selectedRow: null,
  formValues: {},
};

// xterm's terminal realization is part of the web renderer's documented
// degradation ladder, so the shared corpus reaches it too. jsdom has no
// matchMedia, which xterm uses while opening its DOM renderer; provide the
// smallest browser seam needed for this test without pretending to exercise
// layout or a real terminal connection.
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

describe("renderPanel (web-components, binary boundary)", () => {
  it("renders a TablePanel: header, columns, and rows from the wasm", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: mockWasm,
      root,
      descriptor: tableFixture,
      invoker: { invoke: async () => ({ users: [] }) },
      context: EMPTY_CTX,
    });
    expect(root.querySelector(".meridian-uiview-header")?.textContent).toBe("Users");
    const headers = [...root.querySelectorAll("th")].map((th) => th.textContent);
    expect(headers).toEqual(["Name", "Email"]);
    expect(root.querySelectorAll("tbody tr").length).toBe(2); // CANNED_ROWS
  });

  it("routes an AdhocPanel to its registered factory with the canonical descriptor", async () => {
    const root = document.createElement("div");
    let received: string | undefined;
    await renderPanel({
      wasm: mockWasm,
      root,
      descriptor: adhocFixture,
      invoker: { invoke: async () => ({}) },
      context: EMPTY_CTX,
      adhocFactories: {
        "my-handler": (_slot, descriptor) => {
          received = descriptor.panelId;
        },
      },
    });
    expect(received).toBe("custom"); // the factory got the canonical PanelDescriptor
  });

  // The neutral corpus is deliberately rendered through the same web surface
  // as the focused tests above. A header alone would only prove that the
  // outer shell mounted; the meta assertion catches a fixture that falls
  // through the dispatch ladder into the generic no-body path. Shapes without
  // a host capability still pass through their documented degradation (for
  // example, StreamPanel reports that this surface is not live).
  for (const fixture of FIXTURES) {
    it(`renders the canonical ${fixture.name} fixture`, async () => {
      const root = document.createElement("div");
      await renderPanel({
        wasm: mockWasm,
        root,
        descriptor: fixture.descriptor,
        invoker: { invoke: async () => ({}) },
        context: EMPTY_CTX,
        adhocFactories: {
          "overview-dashboard": (_slot, descriptor) => {
            _slot.dataset.panel = descriptor.panelId;
          },
        },
      });

      expect(root.dataset.panel).toBe(fixture.descriptor.panelId);
      expect(root.dataset.panelShape).toBe(fixture.descriptor.body.case || "unset");
      expect(root.querySelector(".meridian-uiview-header")?.textContent).toBe(
        fixture.descriptor.title,
      );
      const meta = root.querySelector(".meridian-uiview-meta")?.textContent;
      if (fixture.shape === "(unset)") {
        expect(meta).toBe("(no body set)");
      } else {
        expect(meta).not.toBe("(no body set)");
      }
      const arm = (fixture.descriptor.body.case || "unset").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      expect(normalizeDom(root)).toMatchSnapshot(`web-components/${arm}`);
    });
  }
});
