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
import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { FormattedValueSchema, PrincipalDisplay, ValueDisplaySchema, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UiviewWasm } from "../src/uiview/renderer.js";
import type { StreamInvoker } from "@savvifi/meridian-schemas/uiview";
import { formatByCore, formatByDisplay, type ValueFormatterWasm } from "@savvifi/meridian-schemas/uiview";
import { STATE_CASES } from "../../../schemas/conformance/state_cases.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";

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

let wasm: UiviewWasm & ValueFormatterWasm;
let core: ReturnType<typeof JSON.parse>;
let values: ReturnType<typeof JSON.parse>;
let renderView: typeof import("../src/uiview/view_renderer.js").renderView;
let disposePanel: typeof import("../src/uiview/renderer.js").disposePanel;
let terminals: typeof import("../src/terminal_panel.js");
const originalCanvasContext = HTMLCanvasElement.prototype.getContext;
afterAll(() => { HTMLCanvasElement.prototype.getContext = originalCanvasContext; });

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
  wasm = mod as unknown as UiviewWasm & ValueFormatterWasm;
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
  it("uses the same explicit-clock corpus as native Rust without reading a browser clock", () => {
    expect(core.valueFormats).toHaveLength(86);
    for (const entry of core.valueFormats) {
      const display = fromBinary(ValueDisplaySchema, wire(entry.display));
      const expected = fromBinary(FormattedValueSchema, wire(entry.expected));
      const now = entry.nowMs === undefined ? undefined : Number(entry.nowMs);
      const actual = formatByCore(entry.input, display, wasm, now);
      expect(actual, entry.name).toEqual({ text: expected.text, ...(expected.title === undefined ? {} : { title: expected.title }) });
      if (now === undefined || (Number.isFinite(now) && Math.abs(now) <= 8_640_000_000_000_000)) {
        expect(actual, `legacy valid-clock parity: ${entry.name}`).toEqual(formatByDisplay(entry.input, display, now));
      }
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
    const bridge = wasm as UiviewWasm & { renderGalleryPanel(bytes: Uint8Array, response: object): unknown };
    for (const entry of core.galleries) {
      const actual = bridge.renderGalleryPanel(wire(entry.gallery), entry.response);
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
    for (const [operation, count] of Object.entries({ paths: 7, requests: 6, tables: 18, galleries: 4, metadata: 5, budgets: 4, valueFormats: 86 })) {
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

  it("rejects malformed and future descriptors without trapping across the real wasm boundary", () => {
    const boundary = wasm as UiviewWasm & {
      renderTablePanel(table: Uint8Array, response: object): unknown;
      renderGalleryPanel(gallery: Uint8Array, response: object): unknown;
    };
    // A tag with a truncated varint is invalid wire data for every descriptor
    // decoder used by the WebAssembly API.
    const malformed = new Uint8Array([0x0a, 0x80]);
    const malformedCalls = [
      () => wasm.renderTable(malformed, {}),
      () => wasm.buildPopulateRequest(malformed, CTX),
      () => wasm.buildRequest(malformed, CTX),
      () => boundary.renderTablePanel(malformed, {}),
      () => boundary.renderGalleryPanel(malformed, {}),
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
