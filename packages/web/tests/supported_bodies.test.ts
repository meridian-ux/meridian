// @vitest-environment jsdom
//
// SUPPORTED_BODIES is exported so hosts stop re-deriving it. botnoc kept its own
// hardcoded allowlist and gated on it BEFORE calling renderPanel, so a shape
// added here stayed invisible until the host was edited too — the console
// reported "Panel build_header has no recognized body" for panels this renderer
// could already draw.
//
// An exported list is only useful if it cannot drift from the actual dispatch.
// These tests pin it in both directions: every listed case must really render,
// and an unlisted case must really not.

import { create } from "@bufbuild/protobuf";
import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it } from "vitest";

import { SUPPORTED_BODIES, renderPanel, supportsBody } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";

const noWasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: () => ({}),
  renderTablePanel: () => [] as RenderedRow[],
  formatLroMetadata: () => "",
};

const CTX = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };

// xterm needs browser APIs jsdom does not implement (matchMedia,
// ResizeObserver). Polyfilled rather than skipping `terminal`, so the one shape
// with a real dependency stays covered by this drift guard instead of being
// quietly exempt — an exempt shape is exactly how ColumnLink went undrawn.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// A minimal descriptor per supported case. Deliberately exhaustive: adding a case
// to SUPPORTED_BODIES without adding a fixture here fails the coverage test below,
// so the list cannot grow without someone proving the shape renders.
const MINIMAL: Record<string, unknown> = {
  table: { populate: { service: "s", method: "m" }, rowsField: "rows", columns: [] },
  lro: { start: { service: "s", method: "m" }, metadataType: "M", responseType: "R" },
  adhoc: { handlerId: "h" },
  form: { fields: [] },
  terminal: { url: "wss://example.test/pty" },
  grammar: { language: 1, source: "# hi" },
  stat: { label: "Churn", value: 1 },
  stream: { subscribe: { service: "s", method: "m" } },
  detailHeader: { title: "T", populate: { service: "s", method: "m" } },
  recordCard: { fields: [], populate: { service: "s", method: "m" } },
  choice: { options: [{ id: "a", label: "A" }] },
  snippet: { snippet: { text: "x" } },
  action: { action: { label: "Go" } },
  copyValue: { value: { label: "Token", value: "x" } },
  connectFlow: { targets: [] },
  catalog: { items: [] },
};

function descriptorFor(bodyCase: string): PanelDescriptor {
  return create(PanelDescriptorSchema, {
    panelId: `p-${bodyCase}`,
    title: "P",
    body: { case: bodyCase, value: MINIMAL[bodyCase] },
  } as never);
}

async function draw(descriptor: PanelDescriptor): Promise<HTMLElement> {
  const root = document.createElement("div");
  await renderPanel({
    wasm: noWasm,
    root,
    descriptor,
    invoker: { invoke: async () => ({}) },
    context: CTX,
  });
  return root;
}

describe("SUPPORTED_BODIES cannot drift from the dispatch", () => {
  it("has a fixture for every listed case", () => {
    // Guards the guard: a new case added to the list without a fixture here
    // would otherwise be silently untested by the loop below.
    expect(Object.keys(MINIMAL).sort()).toEqual([...SUPPORTED_BODIES].sort());
  });

  for (const bodyCase of SUPPORTED_BODIES) {
    it(`renders \`${bodyCase}\` rather than falling through`, async () => {
      const root = await draw(descriptorFor(bodyCase));
      // The fallthrough sets exactly this and appends nothing else.
      const meta = root.querySelector(".meridian-uiview-meta")?.textContent;
      expect(meta).not.toBe("(no body set)");
      // Header + meta are always emitted; a case that rendered adds more.
      expect(root.childElementCount).toBeGreaterThan(2);
    });
  }

  it("supportsBody agrees with the list, and rejects the unknown", () => {
    for (const c of SUPPORTED_BODIES) expect(supportsBody(c)).toBe(true);
    // `llmPrompt` and `gallery` are real oneof arms that renderPanel does NOT
    // draw — hosts handle galleries themselves. They must report false, or a
    // host trusting this would render an empty panel instead of using its own
    // path.
    expect(supportsBody("gallery")).toBe(false);
    expect(supportsBody("llmPrompt")).toBe(false);
    expect(supportsBody("nope")).toBe(false);
    expect(supportsBody(undefined)).toBe(false);
  });
});
