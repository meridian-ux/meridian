// @vitest-environment jsdom
//
// CONFORMANCE ACROSS THE REAL FFI BOUNDARY.
//
// Every other test in this repo hands `renderPanel` a MOCK `UiviewWasm`. That is
// fine for testing rendering, and useless for testing the boundary — a mock
// restates the assumption instead of checking it. And the assumption was wrong:
//
//   `UiviewWasm` declares  renderTable(): RenderedRow[]  with  raw: Record<…>
//                          buildRequest(): object
//
//   serde-wasm-bindgen actually returned a JS **Map** for both, because its
//   default serializes any map that way. TypeScript cannot check across an FFI
//   boundary, so nothing failed — until production, twice:
//
//     • ColumnLink read row["name"], got undefined (Map needs .get), and every
//       build link in the fastverk console pointed at the wrong record.
//     • Every binding-populated request serialized to NOTHING —
//       JSON.stringify(map) === "{}" and Object.entries(map) === [] — so a
//       bound GET sent no query params and a bound POST an empty body.
//
// So this test loads the ACTUAL compiled wasm and asserts the shapes the
// interface claims. If the core ever reverts to Maps, this fails here rather
// than in a browser three repos downstream.

import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { validateFormValues } from "@savvifi/meridian-schemas/uiview";
import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { FormattedValueSchema, PrincipalDisplay, ValueDisplaySchema, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UiviewWasm } from "../src/uiview/renderer.js";
import type { RpcInvoker, StreamInvoker } from "@savvifi/meridian-schemas/uiview";
import { formatByCore, formatByDisplay, type ValueFormatterWasm } from "@savvifi/meridian-schemas/uiview";
import { STATE_CASES } from "../../../schemas/conformance/state_cases.js";
import { LAYOUT_CASES } from "../../../schemas/conformance/layout_cases.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";
import { OPTION_CONSTRAINED_CASES, OPTION_READ_CASES, OPTION_INPUT_CASES } from "../../../schemas/conformance/value_option_cases.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { FORM_DEFAULT_BUDGET_CASES } from "../../../schemas/conformance/value_option_cases.js";

// The project tsconfig sets `types: []` deliberately — this is browser code, and
// pulling in @types/node for a single readFileSync would widen the global scope
// of every source file in the package. So the one node API this test needs is
// reached through a locally-typed dynamic import instead.
type NodeFs = { readFileSync(path: URL | string): Uint8Array };

// The wasm_bindgen `web` target — the exact artifact hosts ship. Its init
// accepts raw bytes, so node can load it without a fetch shim. Copied into this
// package by //tests:wasm_artifacts because vite only loads modules under its
// own root.
const GLUE = "./meridian_uiview.js";
const WASM = "./meridian_uiview_bg.wasm";

// This suite exercises more of the actual core than a renderer host needs.
// Declare those additional capabilities once instead of casting each callsite.
type ConformanceWasm = UiviewWasm & ValueFormatterWasm & {
  staticViewText(bytes: Uint8Array): string;
  matchesFormPattern(pattern: string, input: string): boolean;
  renderGalleryPanel(bytes: Uint8Array, response: object): unknown;
};
let wasm: ConformanceWasm;
let core: ReturnType<typeof JSON.parse>;
let values: ReturnType<typeof JSON.parse>;
let renderView: typeof import("../src/uiview/view_renderer.js").renderView;
let disposePanel: typeof import("../src/uiview/renderer.js").disposePanel;
let terminals: typeof import("../src/terminal_panel.js");
const originalCanvasContext = HTMLCanvasElement.prototype.getContext;
afterAll(() => { HTMLCanvasElement.prototype.getContext = originalCanvasContext; });

describe("canonical whole-view layout corpus across actual WASM", () => {
  it.each(LAYOUT_CASES)("passive text projection: $name", fixture => {
    const text = wasm.staticViewText(toBinary(ViewDescriptorSchema, fixture.view));
    expect(text).toContain(fixture.view.title);
    let cursor = 0;
    for (const id of fixture.staticOrder) {
      const label = `Section: Section ${id}`;
      const next = text.indexOf(label, cursor);
      expect(next).toBeGreaterThanOrEqual(cursor);
      cursor = next + label.length;
    }
    for (const content of fixture.staticContent) expect(text).toContain(content);
  });
  it.each(LAYOUT_CASES)("$name", async fixture => {
    const root = document.createElement("div"); document.body.append(root);
    const invoke = vi.fn(async (service: string, method: string) => fixture.responses[`${service}.${method}`] ?? {});
    const { disposeView } = await import("../src/uiview/view_renderer.js");
    try {
      await renderView({ root, view: fixture.view, wasm, invoker: { invoke }, context: {
        currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {}, selections: fixture.context.selections,
      } });
      expect(root.textContent).toContain(fixture.view.title);
      for (const text of fixture.content) expect(root.textContent).toContain(text);
      expect([...root.querySelectorAll('[data-slot]')].map(e => e.getAttribute("data-slot"))).toEqual(fixture.order);
      const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      expect(tabs.map(tab => tab.textContent)).toEqual(fixture.tabs);
      if (tabs.length) {
        tabs[0].focus(); tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(document.activeElement).toBe(tabs[1]); expect(tabs[0].getAttribute("aria-selected")).toBe("true");
        tabs[1].click();
        await vi.waitFor(() => expect(root.textContent).toContain("Content first"));
        expect(root.textContent).not.toContain("Content last");
      }
      if (fixture.name.startsWith("gate-")) {
        expect(invoke).toHaveBeenCalledTimes(fixture.gateOpen ? 1 : 0);
        expect(root.textContent).toContain(fixture.gateOpen ? "Fetched scoped" : "Choose a scope first");
      } else if (fixture.name === "repeated") {
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(root.textContent).toContain("001.20"); expect(root.textContent).toContain("Second row");
      } else expect(invoke).not.toHaveBeenCalled();
      if (fixture.name === "nested") expect(root.textContent).not.toContain("Content nested");
    } finally { disposeView(root); root.remove(); }
  });
});

beforeAll(async () => {
  // xterm probes canvas during module initialization; jsdom has no canvas.
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof originalCanvasContext;
  ({ renderView } = await import("../src/uiview/view_renderer.js"));
  ({ disposePanel } = await import("../src/uiview/renderer.js"));
  terminals = await import("../src/terminal_panel.js");
  const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as NodeFs;
  const glueUrl = new URL(GLUE, import.meta.url);
  const wasmUrl = new URL(WASM, import.meta.url);
  const mod = await import(glueUrl.href);
  await mod.default({ module_or_path: readFileSync(wasmUrl) });
  wasm = mod as unknown as typeof wasm;
  expect(wasm.renderGalleryPanel).toBeTypeOf("function");
  const text = (path: string) => new TextDecoder().decode(readFileSync(new URL(path, import.meta.url)));
  core = JSON.parse(text("../../../schemas/conformance/core.json"));
  values = JSON.parse(text("../../../schemas/conformance/value_types.json"));
});

const CTX = {
  currentResourcePath: "botnoc-abc",
  uiIdentity: null,
  selectedRow: { name: "row-1", repo: "fastverk/botnoc" },
  formValues: {},
};

describe("composed views through actual WASM", () => {
  const composite = () => create(ViewDescriptorSchema, { title: "Composite", slots: [{ id: "records",
    subViewPopulate: { service: "fixture.Composite", method: "List", bindings: [
      { requestField: "scope", source: { case: "selectionKey", value: "scope" } },
    ] }, subViewRowsField: "records", subView: { title: "Repeated item", slots: [
      { id: "header", panel: { body: { case: "detailHeader", value: { titleSourcePath: "title" } } } },
      { id: "card", panel: { body: { case: "recordCard", value: { fields: [
        { fieldId: "title", label: "Card title", kind: { case: "text", value: {} } },
      ] } } } },
      { id: "form", panel: { body: { case: "form", value: { mode: 2, submit: { service: "fixture.Composite", method: "Save", bindings: [
        { requestField: "recordId", source: { case: "rowField", value: "id" } },
      ] }, fields: [
        { fieldId: "title", label: "Title", kind: { case: "text", value: {} } },
        { fieldId: "enabled", label: "Enabled", kind: { case: "boolean", value: { defaultValue: true } } },
        { fieldId: "count", label: "Count", kind: { case: "integer", value: { defaultValue: 7 } } },
      ] } } } },
      { id: "table", panel: { body: { case: "table", value: { rowsField: "members", columns: [{ header: "Member", fieldPath: "name" }] } } } },
    ] },
  }] });

  it("decodes repeated views and binds owned ambient records without extra reads", async () => {
    const { disposeView } = await import("../src/uiview/view_renderer.js");
    const root = document.createElement("main");
    const records = [
      { id: "first", title: "001.20", enabled: false, count: 0, members: [{ name: "Child A" }] },
      { id: "second", title: "002.00", enabled: true, count: 5, members: [{ name: "Child B" }] },
    ];
    const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, method) => method === "List" ? { records } : {});
    const view = fromBinary(ViewDescriptorSchema, toBinary(ViewDescriptorSchema, composite()));
    try {
      await renderView({ root, view, wasm, context: { ...CTX, selections: { scope: "tenant-raw" } }, invoker: { invoke }, admission: { mutations: ["fixture.Composite/Save"] } });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith("fixture.Composite", "List", { scope: "tenant-raw" });
      const items = [...root.querySelectorAll<HTMLElement>('[data-subview-item]')];
      expect(items).toHaveLength(2);
      for (const [index, item] of items.entries()) {
        expect(item.querySelector(".meridian-uiview-record-title")?.textContent).toBe(records[index].title);
        expect(item.querySelector('[data-slot="card"]')?.textContent).toContain(records[index].title);
        expect(item.querySelector<HTMLFormElement>("form")!.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe(records[index].title);
        expect(item.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(records[index].enabled);
        expect(item.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe(String(records[index].count));
        expect(item.querySelector("table tbody")?.textContent).toContain(index === 0 ? "Child A" : "Child B");
      }
      items[0].querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
      expect(invoke).toHaveBeenLastCalledWith("fixture.Composite", "Save", { recordId: "first", title: "001.20", enabled: false, count: 0 });
      expect(records[0]).toEqual({ id: "first", title: "001.20", enabled: false, count: 0, members: [{ name: "Child A" }] });
    } finally { disposeView(root); }
  });

  it.each(["denied", "bad-rows", "expansion"])("shows %s repeated-view failures without child reads", async failure => {
    const { disposeView } = await import("../src/uiview/view_renderer.js");
    const root = document.createElement("main"), onDenied = vi.fn();
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ records: failure === "bad-rows" ? [null] : Array.from({ length: 250 }, (_, i) => ({ id: String(i) })) }));
    try {
      await renderView({ root, view: composite(), wasm, context: CTX, invoker: { invoke }, admission: { reads: failure === "denied" ? [] : ["fixture.Composite/List"], onDenied } });
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(failure === "denied" ? "reads allowlist" : failure === "bad-rows" ? "must be objects" : "composition limit");
      expect(invoke).toHaveBeenCalledTimes(failure === "denied" ? 0 : 1);
      expect(root.querySelector('[data-subview-item]')).toBeNull();
      if (failure === "denied") expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ tier: "read", method: "List" }));
    } finally { disposeView(root); }
  });

  it("retries a failed repeated read without stale or duplicated items", async () => {
    const { disposeView } = await import("../src/uiview/view_renderer.js");
    const root = document.createElement("main");
    const invoke = vi.fn<RpcInvoker["invoke"]>().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ records: [{ title: "Recovered record", enabled: false, count: 0, members: [] }] });
    try {
      await renderView({ root, view: composite(), wasm, context: CTX, invoker: { invoke } });
      expect(root.querySelector('[role="alert"]')?.textContent).toContain("offline");
      [...root.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Retry section")!.click();
      await vi.waitFor(() => expect(root.querySelector('[data-subview-item]')?.textContent).toContain("Recovered record"));
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(root.querySelectorAll('[data-subview-item]')).toHaveLength(1);
      expect(root.querySelector('[role="alert"]')?.textContent ?? "").toBe("");
    } finally { disposeView(root); }
  });

  it("ignores an obsolete repeated response after selection-bound replacement", async () => {
    const { disposeView } = await import("../src/uiview/view_renderer.js");
    const root = document.createElement("main"); let finish!: (value: object) => void;
    const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, _method, request) => (request as { scope?: string }).scope === "old"
      ? new Promise<object>(resolve => { finish = resolve; }) : { records: [{ title: "Current record", enabled: true, count: 0, members: [] }] });
    const view = composite(); view.slots[0].dependsOnSelectionKey = "scope";
    const old = renderView({ root, view, wasm, context: { ...CTX, selections: { scope: "old" } }, invoker: { invoke } });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    try {
      await renderView({ root, view, wasm, context: { ...CTX, selections: { scope: "new" } }, invoker: { invoke } });
      finish({ records: [{ title: "Obsolete record" }] }); await old;
      expect(root.textContent).toContain("Current record");
      expect(root.textContent).not.toContain("Obsolete record");
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally { disposeView(root); }
  });
});

describe("web-components default budget through real WASM", () => {
  it.each(FORM_DEFAULT_BUDGET_CASES)("$name", async fixture => {
    const container = document.createElement("main"); document.body.append(container);
    const invoke = vi.fn(async () => ({})), onPromptResponse = vi.fn();
    const nativeFrom = Array.from;
    const allocation = vi.spyOn(Array, "from").mockImplementation((source: any, map?: any, receiver?: any) => {
      if (source && !source[Symbol.iterator] && source.length > 1000) throw new Error("unbounded allocation sentinel");
      return nativeFrom(source, map, receiver);
    });
    try {
      await renderView({ root: container, view: fixture.view, wasm, context: CTX, invoker: { invoke }, onPromptResponse,
        admission: { mutations: ["fixture.Inputs/Submit", "fixture.Inputs/Start"] } });
      expect(container.textContent).toContain(fixture.reason);
      expect(container.querySelectorAll("input,select,textarea")).toHaveLength(0);
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      for (const button of container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) {
        expect(button.disabled).toBe(true); button.click();
      }
      await Promise.resolve();
      expect(invoke).not.toHaveBeenCalled(); expect(onPromptResponse).not.toHaveBeenCalled();
      expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(fixture.bytes);
    } finally { allocation.mockRestore(); disposePanel(container); container.remove(); }
  });
});

describe("web-components typed input option defaults through real WASM", () => {
  it.each(OPTION_INPUT_CASES)("$name", async fixture => {
    const container = document.createElement("main"); document.body.append(container);
    const invoke = vi.fn(async () => ({ name: "operations/fixture", done: true, response: {} }));
    const onPromptResponse = vi.fn();
    const clock = vi.spyOn(Date, "now").mockReturnValue(NaN);
    try {
      await renderView({ root: container, view: fixture.view, wasm, context: CTX, invoker: { invoke },
        onPromptResponse, admission: { mutations: ["fixture.Inputs/Submit", "fixture.Inputs/Start"] } });
      expect(invoke).not.toHaveBeenCalled();
      if (fixture.surface === "readonlyForm") {
        const shown = container.querySelector("[data-field]");
        expect(shown?.textContent).toBe(fixture.expected.text);
        expect(shown?.getAttribute("title") ?? undefined).toBe(fixture.expected.title);
        expect(container.querySelector('button[type="submit"]')).toBeNull();
      } else {
        const control = container.querySelector<HTMLInputElement>("textarea,input:not([type=hidden])");
        expect(control).not.toBeNull();
        if (typeof fixture.raw === "number") expect(Number(control!.value)).toBe(fixture.raw);
        else expect(control!.value).toBe(fixture.raw);
        if (fixture.surface === "lro") {
          const run = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Run");
          expect(run).toBeDefined(); run!.click();
        } else container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        if (fixture.surface === "prompt") {
          expect(onPromptResponse).toHaveBeenCalledTimes(1);
          expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ value: fixture.raw });
          expect(invoke).not.toHaveBeenCalled();
        } else if (fixture.surface === "llmPrompt") {
          expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent)
            .toBe(`Value=${typeof fixture.raw === "string" ? fixture.raw : JSON.stringify(fixture.raw)}`);
          expect(invoke).not.toHaveBeenCalled();
        } else await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("fixture.Inputs", fixture.surface === "lro" ? "Start" : "Submit", { value: fixture.raw }));
      }
      expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(fixture.bytes);
    } finally { disposePanel(container); container.remove(); clock.mockRestore(); }
  });
});

describe("web-components value options through real WASM and DOM", () => {
  it.each(OPTION_CONSTRAINED_CASES)("constrained: $name", async fixture => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const container = document.createElement("main");
    document.body.append(container);
    const invoke = vi.fn(async () => ({}));
    const prior = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      await renderView({ root: container, view: fixture.view, wasm, context: CTX, invoker: { invoke } });
      expect(writeText).not.toHaveBeenCalled();
      if (fixture.arm === "stat") expect(container.querySelector(".mer-stat-value")?.textContent).toBe(fixture.expectedText);
      else {
        const copy = container.querySelector<HTMLButtonElement>(".mer-copyvalue-btn")!;
        expect(copy.textContent).toBe(fixture.secret ? "••••••••" : fixture.expectedText);
        expect(copy.querySelector("a")).toBeNull();
        copy.click();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledWith(fixture.raw);
        expect(writeText).toHaveBeenCalledOnce();
        expect(copy.textContent).toBe("Copied");
        await vi.advanceTimersByTimeAsync(1200);
        expect(copy.textContent).toBe(fixture.secret ? "••••••••" : fixture.expectedText);
        if (fixture.secret) {
          const reveal = container.querySelector<HTMLButtonElement>(".mer-reveal")!;
          reveal.click();
          expect(reveal.getAttribute("aria-pressed")).toBe("true");
          expect(copy.textContent).toBe(fixture.expectedText);
          reveal.click();
          expect(reveal.getAttribute("aria-pressed")).toBe("false");
          expect(copy.textContent).toBe("••••••••");
          expect(writeText).toHaveBeenCalledOnce();
        }
      }
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      for (const panel of container.querySelectorAll<HTMLElement>("[data-panel]")) disposePanel(panel);
      container.remove();
      if (prior) Object.defineProperty(navigator, "clipboard", prior);
      else Reflect.deleteProperty(navigator, "clipboard");
      vi.useRealTimers();
    }
  });
  it.each(OPTION_READ_CASES)("$name", async fixture => {
    const container = document.createElement("main");
    document.body.append(container);
    const raw = JSON.stringify(fixture.response);
    const invoke = vi.fn(async () => fixture.response);
    // Imperative read surfaces capture Date.now at mount. An invalid clock
    // explicitly exercises the core's absolute fallback for no-clock cases.
    const clock = vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs ?? NaN);
    // The core table FFI has no clock argument; its documented rung is absolute.
    const expected = fixture.arm === "table" ? fixture.expectedWithoutClock : fixture.expected;
    try {
      await renderView({ root: container, view: fixture.view, wasm, context: CTX, invoker: { invoke } });
      expect(invoke).toHaveBeenCalledWith("fixture.Options", "Get", expect.anything());
      if (fixture.arm === "table") expect(container.querySelector("tbody td")?.textContent).toBe(expected.text);
      else expect(container.textContent).toContain(expected.text);
      const slots = fixture.arm === "gallery" ? 3 : fixture.arm === "resourceCards" ? 4 : 1;
      expect((container.textContent ?? "").split(expected.text).length - 1).toBeGreaterThanOrEqual(slots);
      if (expected.title !== undefined) {
        expect([...container.querySelectorAll("[title]")].filter(node => node.getAttribute("title") === expected.title).length).toBeGreaterThanOrEqual(slots);
      }
      expect(JSON.stringify(fixture.response)).toBe(raw);
    } finally {
      for (const panel of container.querySelectorAll<HTMLElement>("[data-panel]")) disposePanel(panel);
      clock.mockRestore();
      container.remove();
    }
  });
});

// Fixed, reproducible wire mutations complement (not replace) native libFuzzer.
// The corpus remains immutable and every invocation crosses the real bridge.
function wireMutations(seed: Uint8Array): Uint8Array[] {
  const variants = [seed, seed.slice(0, 1), seed.slice(0, Math.floor(seed.length / 2)),
    seed.slice(0, -1), new Uint8Array([...seed, 0x0a, 0x80]),
    new Uint8Array([0x0e, ...seed]), new Uint8Array([...seed, 0xa2, 0x06, 0x00]),
    new Uint8Array([0x0a, ...Array(11).fill(0xff), ...seed])];
  for (const position of [0, Math.floor(seed.length / 2), seed.length - 1]) {
    if (position < 0 || position >= seed.length) continue;
    const changed = seed.slice();
    changed[position] ^= 0xff;
    variants.push(changed);
  }
  return variants;
}

function assertWireDoesNotTrap(bytes: Uint8Array, label: string): void {
  const boundary = wasm as typeof wasm & {
    renderTablePanel(table: Uint8Array, response: object): unknown;
    renderGalleryPanel(gallery: Uint8Array, response: object): unknown;
  };
  expect(typeof wasm.formatValueDisplayAt).toBe("function");
  expect(typeof wasm.staticViewText).toBe("function");
  const response = { rows: [{ value: "2026-03-29", name: "Ada", count: 1, active: false }] };
  const calls = [
    () => wasm.renderTable(bytes, response),
    () => wasm.buildPopulateRequest(bytes, CTX),
    () => wasm.buildRequest(bytes, CTX),
    () => wasm.buildSubmissionRequest!(bytes, CTX, {}),
    () => boundary.renderTablePanel(bytes, response),
    () => boundary.renderGalleryPanel(bytes, response),
    () => wasm.formatValueDisplay(bytes, "2026-03-29"),
    () => wasm.formatValueDisplayAt!(bytes, "2026-03-29", 1_774_742_400_000),
    () => wasm.staticViewText(bytes),
  ];
  for (const [index, call] of calls.entries()) {
    try {
      call(); // A mutation can still be valid protobuf; success is allowed.
    } catch (failure) {
      expect(failure, `${label}, entrypoint ${index}`).toBeInstanceOf(Error);
      expect(failure, `${label}, entrypoint ${index}`).not.toBeInstanceOf(WebAssembly.RuntimeError);
      expect(failure, `${label}, entrypoint ${index}`).not.toBeInstanceOf(RangeError);
    }
  }
}

// Transport only: no network connection or PTY interaction is claimed here.
class CorpusSocket {
  static OPEN = 1;
  static instances: CorpusSocket[] = [];
  readyState = 0;
  binaryType = "";
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  constructor(readonly url: string) { CorpusSocket.instances.push(this); }
  send() {}
  close() { this.readyState = 3; }
}

describe("web-components stateful ViewDescriptor corpus through real WASM", () => {
  it.each(STATE_CASES)("$name", async (fixture) => {
    const container = document.createElement("div");
    document.body.append(container);
    const invoke = vi.fn(async (service: string, method: string, _request: unknown) =>
      service === "fixture.Inputs" && method === "Start" ? { name: "operations/fixture", done: true, response: {} }
      : (fixture.responses[`${service}.${method}`] ?? {}) as object);
    const onPromptResponse = vi.fn();
    const close = vi.fn();
    const subscribe = vi.fn((...[_service, _method, _request, observer]: Parameters<StreamInvoker["subscribe"]>) => {
      for (const frame of (fixture.responses.__streamFrames ?? []) as object[]) observer.onFrame(frame);
      return { close };
    });
    // Pin the documented plain-DOM stream fallback. xterm's virtualized buffer
    // and a computed browser accessibility tree require separate browser proof.
    const log = vi.spyOn(terminals, "renderLogTerminal").mockImplementation(() => {
      throw new Error("stateful DOM corpus: virtual terminal unavailable");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: false, media: "", onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    })) as typeof window.matchMedia;
    CorpusSocket.instances = [];
    vi.stubGlobal("WebSocket", CorpusSocket);
    try {
      await renderView({ root: container, view: fixture.view, wasm, context: CTX,
        invoker: { invoke }, streamInvoker: { subscribe }, onPromptResponse,
        admission: { mutations: ["fixture.Inputs/Submit", "fixture.Inputs/Start"] } });
      if (fixture.arm === "form") await vi.waitFor(() => {
        expect(container.textContent).not.toContain("Loading…");
      });
      const tree = normalizeDom(container);
      expect(container.textContent).toContain(fixture.view.title);
      if (fixture.input) {
        const input = fixture.input;
        if (input.readonly) {
          if (input.masked) expect(container.textContent).not.toContain(String(input.raw));
          else expect((container.textContent ?? "").includes(input.expectedRead) || [...container.querySelectorAll<HTMLInputElement>("input,textarea,select")].some(control => control.value === input.expectedRead)).toBe(true);
        } else {
          if (typeof input.raw === "string" || typeof input.raw === "number") {
            const control = container.querySelector<HTMLInputElement>("select,textarea,input:not([type=hidden])");
            expect(control, "declared scalar input must exist").not.toBeNull();
            expect(control!.value).toBe(String(input.raw));
          } else if (typeof input.raw === "boolean") expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(input.raw);
          if (fixture.arm === "lro") {
            const run = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Run");
            expect(run, "LRO must expose its run gesture").toBeDefined(); run!.click();
          } else {
            expect(container.querySelector("form"), "input surface must collect values").not.toBeNull();
            container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          }
          if (fixture.arm === "prompt") {
            expect(onPromptResponse).toHaveBeenCalledTimes(1);
            expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ value: input.raw });
          } else if (fixture.arm === "llm_prompt") {
            const preview = container.querySelector('[aria-label="User prompt"] pre')!.textContent ?? "";
            if (input.masked) { expect(preview).not.toContain(String(input.raw)); expect(preview).not.toContain("{{value}}"); }
            else expect(preview).toBe(`Value=${typeof input.raw === "string" ? input.raw : JSON.stringify(input.raw)}`);
            expect(invoke).not.toHaveBeenCalled();
          } else await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("fixture.Inputs", fixture.arm === "lro" ? "Start" : "Submit", { value: input.raw }));
        }
        expect(tree).toMatchSnapshot(`web-components/${fixture.name}`);
        return;
      }
      for (const call of Object.keys(fixture.responses).filter(key => !key.startsWith("__"))) {
        expect(invoke.mock.calls.some(([service, method]) => `${service}.${method}` === call), `${fixture.name} must consume ${call}`).toBe(true);
      }
      if (fixture.expectedValue !== undefined) {
        if (fixture.arm === "table") expect(container.querySelector("tbody td")?.textContent).toBe(fixture.expectedValue);
        else expect(container.textContent).toContain(fixture.expectedValue);
        const slots = fixture.arm === "gallery" ? 3 : fixture.arm === "resource_cards" ? 4 : 1;
        expect((container.textContent ?? "").split(fixture.expectedValue).length - 1).toBeGreaterThanOrEqual(slots);
      }
      if (typeof fixture.typedRaw === "string") {
        const button = container.querySelector<HTMLElement>("button.mer-copyvalue-btn");
        expect(button?.textContent).toBe(fixture.expectedValue);
        const prior = Object.getOwnPropertyDescriptor(navigator, "clipboard");
        const writeText = vi.fn(async (_value: string) => {});
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
        vi.useFakeTimers();
        try {
          button!.click();
          expect(writeText).toHaveBeenCalledWith(fixture.typedRaw);
          vi.advanceTimersByTime(1200);
        } finally {
          vi.useRealTimers();
          if (prior) Object.defineProperty(navigator, "clipboard", prior);
          else Reflect.deleteProperty(navigator, "clipboard");
        }
      }
      if (fixture.arm === "table") {
        if (["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Member 00");
        else if (fixture.state === "empty") expect(tree).not.toContain("Member 00");
      }
      if (["gallery", "resource_cards"].includes(fixture.arm) && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Resource 00");
      if (fixture.arm === "detail_header" && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Fixture record");
      if (fixture.arm === "form") {
        // Imperative form controls set the live value property, not an HTML
        // value attribute. Verify it directly, independently of DOM goldens.
        const labels = [...container.querySelectorAll<HTMLInputElement>('input[aria-label="Label"]')];
        expect(labels).toHaveLength(fixture.state === "empty" ? 0 : fixture.state === "typical" ? 2 : 30);
        if (fixture.state !== "empty") expect(labels[0].value).toBe("Section 0");
      }
      if (fixture.arm === "stream") {
        expect(subscribe).toHaveBeenCalledOnce();
        if (fixture.state !== "empty") {
          expect(log).toHaveBeenCalledOnce();
          expect(warn).toHaveBeenCalledOnce();
        } else expect(log).not.toHaveBeenCalled();
        if (fixture.state === "overflow") {
          expect(tree).toContain("Stream line 139");
          expect(tree).not.toContain("Stream line 000");
        }
      }
      expect(tree).toMatchSnapshot(`web-components/${fixture.name}`);
      if (fixture.arm === "prompt") {
        const body = fixture.view.slots[0].panel!.body; if (body.case !== "prompt" || body.value.fields[0].kind.case !== "text") throw new Error("Typed prompt fixture required");
        const raw = body.value.fields[0].kind.value.defaultValue;
        expect(container.querySelector<HTMLInputElement>('[name="reason"]')!.value).toBe(raw);
        container.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
        expect(onPromptResponse).toHaveBeenCalledTimes(1);
        expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ reason: raw });
      }
      if (fixture.arm === "llm_prompt") {
        const slot = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source text"]');
        if (fixture.state === "empty") expect(slot).toBeNull();
        else {
          expect(slot?.value).toBe("A fixture document.");
          slot!.value = "Edited {{text}}\n<script>literal</script>";
          container.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
          const expected = "Summarize Edited {{text}}\n<script>literal</script>".repeat(fixture.state === "overflow" ? 20 : 1);
          expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent).toBe(expected);
          expect(container.querySelector("script")).toBeNull();
          expect(invoke).not.toHaveBeenCalled();
        }
      }
    } finally {
      container.querySelectorAll<HTMLElement>(".meridian-uiview-panel").forEach(disposePanel);
      // Include every panel root regardless of its presentation class.
      container.querySelectorAll<HTMLElement>(".meridian-uiview-slot > div").forEach(disposePanel);
      container.remove();
      window.matchMedia = originalMatchMedia;
      log.mockRestore(); warn.mockRestore(); vi.unstubAllGlobals();
      if (fixture.arm === "stream") expect(close).toHaveBeenCalledOnce();
      for (const socket of CorpusSocket.instances) expect(socket.readyState).toBe(3);
    }
  });
});

const tablePanel: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "builds",
  title: "Builds",
  body: {
    case: "table",
    value: {
      populate: {
        service: "acme.Builds",
        method: "ListBuilds",
        bindings: [
          { requestField: "name", source: { case: "context", value: 1 } }, // CURRENT_RESOURCE_PATH
        ],
      },
      rowsField: "builds",
      columns: [
        { header: "Repo", fieldPath: "repo" },
        { header: "Phase", fieldPath: "phase" },
      ],
    },
  },
});

const wire = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

describe("the native crate's shared fixture corpus through real WASM", () => {
  it("applies the same Rust Unicode patterns through actual WASM and browser field validation", () => {
    expect(core.formPatterns).toHaveLength(16);
    for (const entry of core.formPatterns) {
      if (entry.validPattern) expect(wasm.matchesFormPattern(entry.pattern, entry.input), entry.name).toBe(entry.matches);
      else expect(() => wasm.matchesFormPattern(entry.pattern, entry.input), entry.name).toThrow("invalid pattern");
      for (const kind of ["text", "masked"] as const) {
        const field = create(FormFieldSchema, {fieldId: "value", kind: {case: kind, value: {pattern: entry.pattern, patternErrorMsg: "authored mismatch"}}});
        const error = validateFormValues([field], {value: entry.input});
        if (entry.matches) expect(error, entry.name).toBeUndefined();
        else expect(error, entry.name).toContain(entry.validPattern ? "authored mismatch" : "invalid pattern");
      }
    }
  });
  it("uses the same explicit-clock corpus as native Rust without reading a browser clock", () => {
    expect(core.valueFormats).toHaveLength(355);
    for (const entry of core.valueFormats) {
      const display = fromBinary(ValueDisplaySchema, wire(entry.display));
      const expected = fromBinary(FormattedValueSchema, wire(entry.expected));
      const now = entry.nowMs === undefined ? undefined : Number(entry.nowMs);
      const actual = formatByCore(entry.input, display, wasm, now);
      expect(actual, entry.name).toEqual({ text: expected.text, ...(expected.title === undefined ? {} : { title: expected.title }) });
      expect(actual, `default-core explicit-clock result: ${entry.name}`).toEqual(formatByDisplay(entry.input, display, now));
      expect(formatByCore(entry.input, display, wasm), entry.name).toEqual(formatByDisplay(entry.input, display));
    }
  });

  it("formats every typed fixture through the standalone protobuf result boundary", () => {
    for (const entry of values.cases) {
      const display = create(ValueDisplaySchema, {
        type: entry.type,
        ...(entry.digits === undefined ? {} : { options: { case: "number", value: { fractionDigits: entry.digits } } }),
      });
      const raw = JSON.stringify(entry.raw);
      expect(formatByCore(entry.raw, display, wasm), entry.name).toEqual({ text: entry.expected });
      expect(formatByCore(null, display, wasm), entry.name).toEqual({ text: "—" });
      expect(JSON.stringify(entry.raw), entry.name).toBe(raw);
    }
    for (const entry of core.tables.filter((entry: { name: string }) => entry.name.startsWith("temporal-"))) {
      const table = fromBinary(TablePanelSchema, wire(entry.table));
      expect(formatByCore(entry.response.rows[0].value, table.columns[0]!.valueDisplay!, wasm), entry.name)
        .toEqual({ text: entry.expected[0].cells[0] });
    }
  });

  it("carries principal supporting text from Rust rather than reconstructing it in JavaScript", () => {
    for (const mode of [PrincipalDisplay.UNSPECIFIED, PrincipalDisplay.NAME, PrincipalDisplay.EMAIL, PrincipalDisplay.NAME_WITH_EMAIL_TITLE]) {
      const display = create(ValueDisplaySchema, { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: mode } } });
      for (const raw of ["Ada <ada@example.com>", "ada@example.com", "Ada <not-an-address>", "", null]) {
        expect(formatByCore(raw, display, wasm)).toEqual(formatByDisplay(raw, display));
      }
    }
    expect(() => wasm.formatValueDisplay(new Uint8Array([255]), "raw")).toThrow();
  });

  it("reads the same path fixtures, including false, zero, absent fields, and empty paths", () => {
    for (const entry of core.paths) {
      expect(wasm.readPath(entry.input, entry.path), entry.name).toEqual(entry.expected);
    }
  });

  it("builds the same requests through standalone and table-populate entrypoints", () => {
    for (const entry of core.requests) {
      const bytes = wire(entry.rpc);
      expect(wasm.buildRequest(bytes, entry.context), entry.name).toEqual(entry.expected);
      const descriptor = create(PanelDescriptorSchema, {
        body: { case: "table", value: { populate: fromBinary(RpcCallSchema, bytes) } },
      });
      expect(wasm.buildPopulateRequest(toBinary(PanelDescriptorSchema, descriptor), entry.context), entry.name).toEqual(entry.expected);
    }
  });

  it("renders the same table fixtures through both table entrypoints", () => {
    for (const entry of core.tables) {
      const bytes = wire(entry.table);
      const actual = wasm.renderTablePanel(bytes, entry.response);
      expect(actual, entry.name).toEqual(entry.expected);
      expect(JSON.parse(JSON.stringify(actual)), entry.name).toEqual(entry.expected);
      const descriptor = create(PanelDescriptorSchema, {
        body: { case: "table", value: fromBinary(TablePanelSchema, bytes) },
      });
      expect(wasm.renderTable(toBinary(PanelDescriptorSchema, descriptor), entry.response), entry.name).toEqual(entry.expected);
    }
  });

  it("renders the same gallery fixtures without losing raw rows or navigation slots", () => {
    for (const entry of core.galleries) {
      const actual = wasm.renderGalleryPanel(wire(entry.gallery), entry.response);
      expect(actual, entry.name).toEqual(entry.expected);
      expect(JSON.parse(JSON.stringify(actual)), entry.name).toEqual(entry.expected);
    }
  });

  it("formats the same LRO metadata fixtures", () => {
    for (const entry of core.metadata) {
      expect(wasm.formatLroMetadata(entry.input), entry.name).toBe(entry.expected);
    }
  });

  it("admits the same payload sequences, including invalid clocks and rolling-window edges", () => {
    const Budget = wasm.WasmPayloadBudget!;
    for (const entry of core.budgets) {
      const budget = new Budget(entry.maxBytes, entry.maxRate);
      for (const frame of entry.frames) {
        expect(budget.admit(frame.bytes, Number(frame.now)), `${entry.name} at ${frame.now}`).toBe(frame.expected);
      }
    }
  });

  it("runs every native ValueType fixture and null fallback through both table entrypoints", () => {
    expect(values.cases).toHaveLength(29);
    for (const entry of values.cases) {
      const table = create(TablePanelSchema, {
        rowsField: "rows",
        columns: [{ fieldPath: "value", valueDisplay: {
          type: entry.type,
          options: entry.digits === undefined ? undefined : { case: "number", value: { fractionDigits: entry.digits } },
        } }],
      });
      const response = { rows: [{ value: entry.raw }, { value: null }] };
      const expected = [
        { raw: { value: entry.raw }, cells: [entry.expected] },
        { raw: { value: null }, cells: ["—"] },
      ];
      expect(wasm.renderTablePanel(toBinary(TablePanelSchema, table), response), entry.name).toEqual(expected);
      const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: table } });
      expect(wasm.renderTable(toBinary(PanelDescriptorSchema, descriptor), response), entry.name).toEqual(expected);
    }
  });

  it("retains every operation and unique fixture names", () => {
    for (const [operation, count] of Object.entries({ paths: 7, requests: 8, tables: 18, galleries: 4, metadata: 5, budgets: 4, valueFormats: 355 })) {
      const cases = core[operation];
      expect(cases, operation).toHaveLength(count);
      expect(new Set(cases.map((entry: { name: string }) => entry.name)).size, operation).toBe(count);
    }
  });
});

const RESPONSE = {
  builds: [{ name: "botnoc-abc", repo: "fastverk/botnoc", phase: "Succeeded" }],
};

describe("the real wasm satisfies the UiviewWasm interface", () => {
  it("renderTable returns rows whose `raw` is a PLAIN object", () => {
    const rows = wasm.renderTable(toBinary(PanelDescriptorSchema, tablePanel), RESPONSE);
    expect(rows).toHaveLength(1);
    const raw = rows[0].raw;

    // The declaration is `Record<string, unknown>`. Make that mean something.
    expect(raw instanceof Map).toBe(false);
    expect(raw.name).toBe("botnoc-abc");
    // The two operations that silently produced nothing for a Map.
    expect(Object.entries(raw).length).toBeGreaterThan(0);
    expect(JSON.stringify(raw)).toContain("botnoc-abc");

    expect(rows[0].cells).toEqual(["fastverk/botnoc", "Succeeded"]);
  });

  it("buildPopulateRequest returns a PLAIN object carrying its bindings", () => {
    const request = wasm.buildPopulateRequest(
      toBinary(PanelDescriptorSchema, tablePanel),
      CTX,
    );
    expect(request instanceof Map).toBe(false);
    // The binding resolved from CURRENT_RESOURCE_PATH — the exact path that
    // silently sent nothing and left every per-build panel empty.
    expect(request).toEqual({ name: "botnoc-abc" });
    expect(new URLSearchParams(Object.entries(request as Record<string, string>)).toString())
      .toBe("name=botnoc-abc");
  });

  it("buildRequest returns a PLAIN object, including nested bindings", () => {
    const rpc = create(RpcCallSchema, {
      service: "acme.Builds",
      method: "ListBuildTargets",
      bindings: [
        { requestField: "name", source: { case: "rowField", value: "name" } },
        {
          requestField: "page",
          source: {
            case: "nested",
            value: {
              fields: [{ requestField: "limit", source: { case: "literal", value: "50" } }],
            },
          },
        },
      ],
    });
    const request = wasm.buildRequest(toBinary(RpcCallSchema, rpc), CTX) as Record<
      string,
      unknown
    >;
    expect(request instanceof Map).toBe(false);
    expect(request.name).toBe("row-1");
    // Nested too — a NestedBinding sub-object breaks identically one level down.
    expect(request.page instanceof Map).toBe(false);
    expect(request.page).toEqual({ limit: "50" });
    expect(JSON.stringify(request)).toContain("row-1");
  });

  it("rejects excessive request depth and cumulative copying at the real wasm boundary", () => {
    const deep = create(RpcCallSchema, {
      bindings: [{ requestField: "a.".repeat(100) + "leaf", source: { case: "literal", value: "secret" } }],
    });
    expect(() => wasm.buildRequest(toBinary(RpcCallSchema, deep), CTX))
      .toThrow("request construction limit exceeded");
    const repeated = create(RpcCallSchema, {
      bindings: Array.from({ length: 10 }, () => ({
        requestField: "value", source: { case: "context" as const, value: 2 },
      })),
    });
    expect(() => wasm.buildRequest(toBinary(RpcCallSchema, repeated), {
      ...CTX, uiIdentity: { payload: "x".repeat(700_000) },
    })).toThrow("request construction limit exceeded");
  });

  it("resolves live signals in the core without losing false or zero", () => {
    const rpc = create(RpcCallSchema, {
      bindings: ["zero", "disabled", "empty", "missing"].map(name => ({
        requestField: `selection.${name}`, source: { case: "signal" as const, value: name },
      })),
    });
    expect(wasm.buildRequest(toBinary(RpcCallSchema, rpc), {
      ...CTX, signals: { zero: 0, disabled: false, empty: null },
    })).toEqual({ selection: { zero: 0, disabled: false } });
  });

  it.each(["form", "lro"] as const)("assembles %s automatic fields and bindings in the real core", arm => {
    const fields = [{ fieldId: "input.name", requestField: "settings.name", kind: { case: "text" as const, value: {} } }];
    const call = { bindings: [{ requestField: "bound", source: { case: "formField" as const, value: "input.name" } }] };
    const descriptor = create(PanelDescriptorSchema, {
      body: arm === "form" ? { case: "form", value: { fields, submit: call } }
        : { case: "lro", value: { inputs: fields, start: call } },
    });
    const request = wasm.buildSubmissionRequest!(toBinary(PanelDescriptorSchema, descriptor), CTX, { "input.name": "001.20", hidden: "not sent" });
    expect(request).toEqual(arm === "form"
      ? { bound: "001.20", "input.name": "001.20" }
      : { bound: "001.20", settings: { name: "001.20" } });
    expect(request).not.toBeInstanceOf(Map);
  });

  it.each(["form", "lro"] as const)("rejects combined %s copy amplification without dispatch, then permits a corrected retry", async arm => {
    const fields = [{ fieldId: "extra", kind: { case: "text" as const, value: {} } }];
    const call = { service: "fixture.Submit", method: "Run", bindings: Array.from({ length: 5 }, () => ({
      requestField: "same", source: { case: "context" as const, value: 2 },
    })) };
    const descriptor = create(PanelDescriptorSchema, {
      body: arm === "form" ? { case: "form", value: { fields, mode: 2, submit: call } }
        : { case: "lro", value: { inputs: fields, start: call } },
    });
    const ctx = { ...CTX, uiIdentity: { payload: "x".repeat(700_000) } };
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ done: true }));
    const root = document.createElement("main");
    const { renderPanel, disposePanel } = await import("../src/uiview/renderer.js");
    try {
      await renderPanel({ root, descriptor, wasm, context: ctx, invoker: { invoke }, admission: "unrestricted" });
      const input = root.querySelector<HTMLInputElement>("input")!;
      input.value = "y".repeat(900_000);
      const submit = () => arm === "form"
        ? root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
        : root.querySelector<HTMLButtonElement>("button")!.click();
      submit();
      await vi.waitFor(() => expect(root.textContent).toContain("Submission request construction rejected."));
      expect(invoke).not.toHaveBeenCalled();
      input.value = "ok"; submit();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      expect(invoke.mock.calls[0][2]).toEqual({ same: ctx.uiIdentity, extra: "ok" });
    } finally { disposePanel(root); }
  });

  it.each(["missing", "rejects"])("fails closed when submission assembly %s", async failure => {
    const { renderPanel, disposePanel } = await import("../src/uiview/renderer.js");
    const root = document.createElement("main"), invoke = vi.fn(async () => ({}));
    const descriptor = create(PanelDescriptorSchema, { body: { case: "form", value: {
      mode: 2, submit: { service: "fixture.Form", method: "Save" }, fields: [],
    } } });
    try {
      await renderPanel({ root, descriptor, wasm: { ...wasm, buildSubmissionRequest: failure === "missing" ? undefined : () => { throw new Error("private payload"); } }, context: CTX, invoker: { invoke }, admission: "unrestricted" });
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe("Submission request construction rejected."));
      expect(invoke).not.toHaveBeenCalled();
      expect(root.textContent).not.toContain("private payload");
    } finally { disposePanel(root); }
  });

  it.each([false, true])("requires mutation admission for LRO finalization even when reads allow it: %s", async admitFinalize => {
    const { renderPanel, disposePanel } = await import("../src/uiview/renderer.js");
    const descriptor = create(PanelDescriptorSchema, { body: { case: "lro", value: {
      start: { service: "fixture.Lro", method: "Start" },
      finalize: { service: "fixture.Lro", method: "Finalize", bindings: [
        { requestField: "result", source: { case: "rowField", value: "token" } },
      ] },
    } } });
    const root = document.createElement("main"), onDenied = vi.fn();
    const invoke = vi.fn(async (_service: string, method: string) => method === "Start"
      ? { name: "operations/test", done: true, response: { "@type": "type.googleapis.com/fixture.Result", token: "001.20" } }
      : {});
    try {
      await renderPanel({ root, descriptor, wasm, context: CTX, invoker: { invoke }, admission: {
        reads: ["fixture.Lro/Finalize"],
        mutations: admitFinalize ? ["fixture.Lro/Start", "fixture.Lro/Finalize"] : ["fixture.Lro/Start"], onDenied,
      } });
      root.querySelector<HTMLButtonElement>("button")!.click();
      await vi.waitFor(() => expect(root.textContent).toContain(admitFinalize ? "Done." : "Finalize failed:"));
      expect(invoke).toHaveBeenCalledTimes(admitFinalize ? 2 : 1);
      if (admitFinalize) {
        expect(invoke).toHaveBeenLastCalledWith("fixture.Lro", "Finalize", { result: "001.20" });
        expect(onDenied).not.toHaveBeenCalled();
      } else {
        expect(root.textContent).toContain("fixture.Lro/Finalize");
        expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ tier: "mutation", service: "fixture.Lro", method: "Finalize" }));
        expect(root.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
      }
    } finally { disposePanel(root); }
  });

  it.each([false, true])("keeps operation polling read-tier and stops denied polls before finalization: %s", async admitPoll => {
    const { renderPanel, disposePanel } = await import("../src/uiview/renderer.js");
    const descriptor = create(PanelDescriptorSchema, { body: { case: "lro", value: {
      start: { service: "fixture.Lro", method: "Start" },
      finalize: { service: "fixture.Lro", method: "Finalize" },
    } } });
    const root = document.createElement("main"), onDenied = vi.fn();
    const invoke = vi.fn(async (_service: string, method: string) => method === "Start"
      ? { name: "operations/scoped", done: false }
      : { name: "operations/scoped", done: true, response: {} });
    try {
      await renderPanel({ root, descriptor, wasm, context: CTX, invoker: { invoke }, admission: {
        reads: admitPoll ? ["google.longrunning.Operations/WaitOperation"] : [],
        mutations: ["fixture.Lro/Start", "fixture.Lro/Finalize"], onDenied,
      } });
      root.querySelector<HTMLButtonElement>("button")!.click();
      await vi.waitFor(() => expect(root.textContent).toContain(admitPoll ? "Done." : "Poll failed:"));
      expect(invoke).toHaveBeenCalledTimes(admitPoll ? 3 : 1);
      if (admitPoll) {
        expect(invoke).toHaveBeenNthCalledWith(2, "google.longrunning.Operations", "WaitOperation", {
          name: "operations/scoped", timeout: { seconds: 5 },
        });
        expect(invoke).toHaveBeenLastCalledWith("fixture.Lro", "Finalize", {});
        expect(onDenied).not.toHaveBeenCalled();
      } else {
        expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ tier: "read", service: "google.longrunning.Operations", method: "WaitOperation" }));
        expect(root.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
      }
    } finally { disposePanel(root); }
  });

  it("rejects an excessive finalize request without a second RPC", async () => {
    const { renderPanel, disposePanel } = await import("../src/uiview/renderer.js");
    const root = document.createElement("main"), invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ done: true, response: {} }));
    const descriptor = create(PanelDescriptorSchema, { body: { case: "lro", value: {
      start: { service: "fixture.Lro", method: "Start" }, finalize: {
        service: "fixture.Lro", method: "Finalize", bindings: [{
          requestField: "a.".repeat(100) + "leaf", source: { case: "literal", value: "not sent" },
        }],
      },
    } } });
    try {
      await renderPanel({ root, descriptor, wasm, context: CTX, invoker: { invoke }, admission: "unrestricted" });
      root.querySelector<HTMLButtonElement>("button")!.click();
      await vi.waitFor(() => expect(root.textContent).toContain("Finalize request construction rejected."));
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke.mock.calls[0][1]).toBe("Start");
    } finally { disposePanel(root); }
  });

  it("converts inert request maps and null-prototype records without losing raw values", () => {
    const selection = Object.assign(Object.create(null), { zero: 0, disabled: false });
    const rpc = create(RpcCallSchema, { bindings: [
      { requestField: "identity", source: { case: "context", value: 2 } },
      { requestField: "zero", source: { case: "selectionKey", value: "zero" } },
      { requestField: "disabled", source: { case: "selectionKey", value: "disabled" } },
    ] });
    expect(wasm.buildRequest(toBinary(RpcCallSchema, rpc), {
      ...CTX, uiIdentity: new Map([["raw", "001.20"]]), selections: selection,
    })).toEqual({ identity: { raw: "001.20" }, zero: 0, disabled: false });
  });

  it.each(["cycle", "deep", "wide", "string", "aliases", "nonfinite", "opaque"])(
    "rejects %s request input before unbounded conversion across all request exports", kind => {
      let value: unknown;
      if (kind === "cycle") { const cycle: Record<string, unknown> = {}; cycle.self = cycle; value = cycle; }
      if (kind === "deep") { value = 0; for (let i = 0; i < 80; i++) value = { child: value }; }
      if (kind === "wide") value = new Array(65_537);
      if (kind === "string") value = "x".repeat(6 * 1024 * 1024);
      if (kind === "aliases") value = Array(32).fill("x".repeat(200_000));
      if (kind === "nonfinite") value = Number.POSITIVE_INFINITY;
      if (kind === "opaque") value = new Date();
      const rpc = create(RpcCallSchema, {});
      const table = create(PanelDescriptorSchema, { body: { case: "table", value: { populate: rpc } } });
      const form = create(PanelDescriptorSchema, { body: { case: "form", value: { submit: rpc } } });
      const context = { ...CTX, uiIdentity: value as object };
      for (const call of [
        () => wasm.buildRequest(toBinary(RpcCallSchema, rpc), context),
        () => wasm.buildPopulateRequest(toBinary(PanelDescriptorSchema, table), context),
        () => wasm.buildSubmissionRequest!(toBinary(PanelDescriptorSchema, form), context, {}),
      ]) {
        try { call(); expect.fail("unsafe input accepted"); }
        catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect(error).not.toBeInstanceOf(WebAssembly.RuntimeError);
          expect(error).not.toBeInstanceOf(RangeError);
          expect((error as Error).message).toBe("request input rejected");
        }
      }
    },
  );

  it("preserves prototype-looking raw data keys without inherited request properties", () => {
    const raw = JSON.parse('{"__proto__":{"enabled":false},"constructor":"raw","value":0}');
    const rpc = create(RpcCallSchema, { bindings: [{ requestField: "identity", source: { case: "context", value: 2 } }] });
    const request = wasm.buildRequest(toBinary(RpcCallSchema, rpc), { ...CTX, uiIdentity: raw }) as { identity: Record<string, unknown> };
    expect(Object.getPrototypeOf(request.identity)).toBe(Object.prototype);
    expect(Object.hasOwn(request.identity, "__proto__")).toBe(true);
    expect(JSON.stringify(request.identity)).toBe(JSON.stringify(raw));
    expect(Object.hasOwn(Object.prototype, "enabled")).toBe(false);
  });

  it("enforces the request JSON output ceiling independently of copy-work accounting", () => {
    const descriptor = create(PanelDescriptorSchema, { body: { case: "form", value: {
      submit: {}, fields: [{ fieldId: "x", kind: { case: "text", value: {} } }],
    } } });
    const bytes = toBinary(PanelDescriptorSchema, descriptor);
    const limit = 4 * 1024 * 1024;
    expect(JSON.stringify(wasm.buildSubmissionRequest!(bytes, CTX, { x: "a".repeat(limit - 8) })).length).toBe(limit);
    expect(() => wasm.buildSubmissionRequest!(bytes, CTX, { x: "a".repeat(limit - 3) })).toThrow("request output rejected");
  });

  it("accepts the input depth boundary and bounded unused data without changing requests", () => {
    const rpc = toBinary(RpcCallSchema, create(RpcCallSchema));
    let value: unknown = 0;
    for (let i = 0; i < 63; i++) value = { child: value };
    expect(wasm.buildRequest(rpc, { ...CTX, uiIdentity: value as object })).toEqual({});
    expect(() => wasm.buildRequest(rpc, { ...CTX, uiIdentity: { child: value } })).toThrow("request input rejected");
    expect(wasm.buildRequest(rpc, { ...CTX, uiIdentity: { unused: "x".repeat(5 * 1024 * 1024) } })).toEqual({});
  });

  it("bounds a repeating Map iterator instead of trusting its eventual completion", () => {
    let iterations = 0;
    const map = new Map();
    map[Symbol.iterator] = function* () { while (true) { iterations++; yield ["same", null]; } };
    const rpc = toBinary(RpcCallSchema, create(RpcCallSchema));
    expect(() => wasm.buildRequest(rpc, { ...CTX, uiIdentity: map })).toThrow("request input rejected");
    expect(iterations).toBeGreaterThan(0);
    expect(iterations).toBeLessThanOrEqual(65_536);
  });

  it("rejects accessors without invoking them and sanitizes proxy exceptions", () => {
    const getter = vi.fn(() => { throw new Error("private getter payload"); });
    const record = Object.defineProperty({}, "secret", { enumerable: true, get: getter });
    const array = Object.defineProperty([0], "0", { get: getter });
    const proxy = new Proxy({}, { ownKeys() { throw new Error("private proxy payload"); } });
    const rpc = toBinary(RpcCallSchema, create(RpcCallSchema));
    for (const value of [record, array, proxy]) {
      expect(() => wasm.buildRequest(rpc, { ...CTX, uiIdentity: value })).toThrow("request input rejected");
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("shares one input conversion budget between submission context and field values", () => {
    const descriptor = create(PanelDescriptorSchema, { body: { case: "form", value: {
      submit: {}, fields: [{ fieldId: "extra", kind: { case: "text", value: {} } }],
    } } });
    expect(() => wasm.buildSubmissionRequest!(toBinary(PanelDescriptorSchema, descriptor), {
      ...CTX, uiIdentity: { unused: "x".repeat(2 * 1024 * 1024) },
    }, { extra: "y".repeat(4 * 1024 * 1024) })).toThrow("request input rejected");
  });

  it("shows a safe submission error instead of dispatching cyclic context", async () => {
    const { renderPanel, disposePanel } = await import("../src/uiview/renderer.js");
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const root = document.createElement("main"), invoke = vi.fn(async () => ({}));
    const descriptor = create(PanelDescriptorSchema, { body: { case: "form", value: {
      mode: 2, submit: { service: "fixture.Form", method: "Save" }, fields: [],
    } } });
    try {
      await renderPanel({ root, descriptor, wasm, context: { ...CTX, uiIdentity: cyclic }, invoker: { invoke }, admission: "unrestricted" });
      root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toBe("Submission request construction rejected."));
      expect(invoke).not.toHaveBeenCalled();
    } finally { disposePanel(root); }
  });

  it.each(["cycle", "deep", "wide", "accessor"])("rejects %s data across every dynamic render-input export", kind => {
    const getter = vi.fn(() => { throw new Error("private value"); });
    let value: object = {};
    if (kind === "cycle") (value as Record<string, unknown>).self = value;
    if (kind === "deep") for (let i = 0; i < 80; i++) value = { child: value };
    if (kind === "wide") value = new Array(65_537);
    if (kind === "accessor") Object.defineProperty(value, "secret", { enumerable: true, get: getter });
    const table = create(TablePanelSchema, { rowsField: "rows" });
    const panel = create(PanelDescriptorSchema, { body: { case: "table", value: table } });
    const galleryWire = toBinary(GalleryPanelSchema, create(GalleryPanelSchema, { rowsField: "rows" }));
    const bridge = wasm as typeof wasm & { renderGalleryPanel(bytes: Uint8Array, value: object): unknown; formatInferredValue(value: object): string };
    for (const call of [
      () => bridge.formatInferredValue(value),
      () => wasm.formatValueDisplay(toBinary(ValueDisplaySchema, create(ValueDisplaySchema)), value),
      () => wasm.formatValueDisplayAt!(toBinary(ValueDisplaySchema, create(ValueDisplaySchema)), value, 0),
      () => wasm.readPath(value, "field"),
      () => wasm.renderTable(toBinary(PanelDescriptorSchema, panel), value),
      () => wasm.renderTablePanel(toBinary(TablePanelSchema, table), value),
      () => bridge.renderGalleryPanel(galleryWire, value),
      () => wasm.formatLroMetadata(value),
    ]) {
      try { call(); expect.fail("unsafe render input accepted"); }
      catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(WebAssembly.RuntimeError);
        expect(error).not.toBeInstanceOf(RangeError);
        expect((error as Error).message).toBe("render input rejected");
      }
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("preflights repeated table cells and gallery slots before output amplification", async () => {
    const response = { rows: [{ value: "x".repeat(400_000) }] };
    const table = create(TablePanelSchema, { rowsField: "rows", columns: Array.from({ length: 8 }, () => ({ fieldPath: "value" })), populate: { service: "fixture.Data", method: "List" } });
    expect(() => wasm.renderTablePanel(toBinary(TablePanelSchema, table), response)).toThrow("render construction rejected");
    const empty = create(TablePanelSchema, { rowsField: "rows", columns: Array.from({ length: 4096 }, () => ({})) });
    expect(() => wasm.renderTablePanel(toBinary(TablePanelSchema, empty), { rows: [] })).toThrow("render construction rejected");
    const gallery = create(GalleryPanelSchema, { rowsField: "rows", card: {
      titleField: "value", subtitleField: "value", statusField: "value", hrefField: "value", iconField: "value", actionLabelField: "value",
    } });
    const bridge = wasm as typeof wasm & { renderGalleryPanel(bytes: Uint8Array, value: object): unknown };
    expect(() => bridge.renderGalleryPanel(toBinary(GalleryPanelSchema, gallery), response)).toThrow("render construction rejected");
    const root = document.createElement("main"), invoke = vi.fn(async () => response);
    const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: table } });
    const { renderPanel, disposePanel } = await import("../src/uiview/renderer.js");
    try {
      await renderPanel({ root, descriptor, wasm, context: CTX, invoker: { invoke } });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(root.textContent).toContain("render construction rejected");
      expect(root.querySelectorAll("tbody tr[data-row]")).toHaveLength(0);
    } finally { disposePanel(root); }
  });

  it("preserves raw prototype-looking row keys across render and readPath output", () => {
    const raw = JSON.parse('{"__proto__":{"enabled":false},"name":"Ada","nullable":null}');
    const table = create(TablePanelSchema, { rowsField: "rows", columns: [{ fieldPath: "name" }] });
    const rows = wasm.renderTablePanel(toBinary(TablePanelSchema, table), { rows: [raw] });
    const result = rows[0].raw;
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(JSON.stringify(result)).toBe(JSON.stringify(raw));
    expect(JSON.stringify(wasm.readPath(raw, ""))).toBe(JSON.stringify(raw));
  });

  it("rejects expanded render JSON at the streaming output ceiling", () => {
    const table = create(TablePanelSchema, { rowsField: "rows", columns: [] });
    // Raw-row copying fits; the result's raw/cells wrapper crosses the ceiling.
    const response = { rows: [{ value: "x".repeat(4 * 1024 * 1024 - 16) }] };
    expect(() => wasm.renderTablePanel(toBinary(TablePanelSchema, table), response)).toThrow("render output rejected");
  });

  it("rejects oversized standalone formatting before computing the text", () => {
    const bridge = wasm as typeof wasm & { formatInferredValue(value: unknown): string };
    expect(() => bridge.formatInferredValue("x".repeat(5 * 1024 * 1024))).toThrow("render construction rejected");
    expect(() => wasm.formatLroMetadata({ status_message: "x".repeat(5 * 1024 * 1024) })).toThrow("render construction rejected");
  });

  it("readPath resolves dotted paths over a plain object", () => {
    expect(wasm.readPath(RESPONSE.builds[0], "repo")).toBe("fastverk/botnoc");
    expect(wasm.readPath({ a: { b: { c: 7 } } }, "a.b.c")).toBe(7);
  });

  it("exports the shared payload budget policy across the real wasm boundary", () => {
    expect(wasm.WasmPayloadBudget).toBeTypeOf("function");
    const Budget = wasm.WasmPayloadBudget!;

    const session = new Budget(8, 5);
    expect(session.admit(3, 100)).toBe(0);
    expect(session.admit(3, 500)).toBe(2);
    expect(session.admit(3, 1_101)).toBe(0);
    expect(session.admit(3, 1_102)).toBe(1);

    const invalidClock = new Budget(8, 8);
    expect(invalidClock.admit(1, Number.NaN)).toBe(3);
    expect(invalidClock.admit(1, -1)).toBe(3);
    expect(invalidClock.admit(1, 10)).toBe(0);
    expect(invalidClock.admit(1, 9)).toBe(3);
  });

  it.each(STATE_CASES.filter(fixture => fixture.state === "typical"))(
    "$name wire mutations never trap across decoder entrypoints", fixture => {
      const panel = fixture.view.slots[0]?.panel;
      expect(panel, fixture.name).toBeDefined();
      const seed = toBinary(PanelDescriptorSchema, panel!);
      for (const [index, bytes] of wireMutations(seed).entries()) {
        assertWireDoesNotTrap(bytes, `${fixture.name}, mutation ${index}`);
      }
      const viewSeed = toBinary(ViewDescriptorSchema, fixture.view);
      for (const [index, bytes] of wireMutations(viewSeed).entries()) {
        assertWireDoesNotTrap(bytes, `${fixture.name} view, mutation ${index}`);
      }
    },
  );

  it("mutates the typed RPC/table/gallery/display seeds without trapping", () => {
    const wire = (text: string) => Uint8Array.from(atob(text), character => character.charCodeAt(0));
    const seeds = [wire(core.requests[0].rpc), wire(core.tables[0].table),
      wire(core.galleries[0].gallery), toBinary(ValueDisplaySchema, create(ValueDisplaySchema, {
        type: ValueType.DATE_TIME, options: { case: "temporal", value: { display: 3 } },
      }))];
    for (const [seedIndex, seed] of seeds.entries()) {
      for (const [index, bytes] of wireMutations(seed).entries()) {
        assertWireDoesNotTrap(bytes, `typed seed ${seedIndex}, mutation ${index}`);
      }
    }
  });

  it.each(LAYOUT_CASES)("$name view wire mutations never trap across decoder entrypoints", fixture => {
    const seed = toBinary(ViewDescriptorSchema, fixture.view);
    for (const [index, bytes] of wireMutations(seed).entries()) {
      assertWireDoesNotTrap(bytes, `view ${fixture.name}, mutation ${index}`);
    }
    expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(seed);
  });

  it.each(["wire", "depth", "nodes", "lines", "output", "bytes"])(
    "rejects excessive or malformed passive view %s across actual WASM", kind => {
      let bytes: Uint8Array;
      if (kind === "wire") bytes = new Uint8Array([0x0a, 0x80]);
      else if (kind === "bytes") bytes = new Uint8Array(4 * 1024 * 1024 + 1);
      else {
        let view = create(ViewDescriptorSchema);
        if (kind === "depth") {
          for (let index = 0; index < 70; index++) {
            view = create(ViewDescriptorSchema, { slots: [{ subView: view }] });
          }
        } else if (kind === "nodes") {
          view = create(ViewDescriptorSchema, { slots: Array.from({ length: 1001 }, () => ({})) });
        } else view.title = kind === "lines" ? "\n".repeat(4097) : "x".repeat(1024 * 1024 + 1);
        bytes = toBinary(ViewDescriptorSchema, view);
      }
      let failure: unknown;
      try { wasm.staticViewText(bytes); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(WebAssembly.RuntimeError);
      expect(failure).not.toBeInstanceOf(RangeError);
      expect((failure as Error).message).toMatch(/view (declaration|construction) rejected/);
      // Rejection must leave the instance usable, not hide a poisoned trap.
      expect(wasm.staticViewText(toBinary(ViewDescriptorSchema,
        create(ViewDescriptorSchema, { title: "After rejection" })))).toContain("After rejection");
    },
  );

  it("rejects malformed and future descriptors without trapping across the real wasm boundary", () => {
    // A tag with a truncated varint is invalid wire data for every descriptor
    // decoder used by the WebAssembly API.
    const malformed = new Uint8Array([0x0a, 0x80]);
    const malformedCalls = [
      () => wasm.renderTable(malformed, {}),
      () => wasm.buildPopulateRequest(malformed, CTX),
      () => wasm.buildRequest(malformed, CTX),
      () => wasm.renderTablePanel(malformed, {}),
      () => wasm.renderGalleryPanel(malformed, {}),
    ];
    for (const call of malformedCalls) {
      let failure: unknown;
      try {
        call();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(WebAssembly.RuntimeError);
      expect((failure as Error).message).toMatch(/decode|varint|buffer|length/i);
    }

    // Unknown fields are legal protobuf wire data. The descriptor decoder must
    // discard this future oneof tag and the typed helper must return an ordinary
    // shape error rather than trap or misinterpret it.
    const futureArm = new Uint8Array([0xa2, 0x06, 0x00]); // field 100, empty bytes
    let failure: unknown;
    try {
      wasm.renderTable(futureArm, {});
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(WebAssembly.RuntimeError);
    expect((failure as Error).message).toContain("descriptor body is not TABLE");

  });
});
