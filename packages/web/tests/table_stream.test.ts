// @vitest-environment jsdom
//
// The interactions a TablePanel has always described but this renderer used to
// drop — row selection, RowActions, ColumnLink — plus the StreamPanel shape and
// the disposal contract that keeps a live subscription from outliving its panel.
//
// These are regression tests for a specific class of bug: a descriptor field
// that is authored, shipped, and silently never drawn. fastverk's builds table
// declared three RowActions that no user could ever reach.

import { create, fromBinary } from "@bufbuild/protobuf";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  DetailHeaderPanelSchema,
  PanelDescriptorSchema,
  RecordCardPanelSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PrincipalDisplay, TemporalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { disposePanel, renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import type { StreamInvoker } from "@savvifi/meridian-schemas/uiview";
import { streamFixture, tableWithActionsFixture } from "./fixtures.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";

const ROWS: RenderedRow[] = [
  { raw: { name: "botnoc-abc", repo: "fastverk/botnoc", phase: "Building" }, cells: ["fastverk/botnoc", "Building"] },
  { raw: { name: "badge-def", repo: "fastverk/badge", phase: "Succeeded" }, cells: ["fastverk/badge", "Succeeded"] },
];

// readPath is real enough for RowFilter + line_field: a dotted walk.
const readPath = (value: object, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]),
    value,
  );

function wasmWith(rows: RenderedRow[]): UiviewWasm {
  return {
    PayloadBudget: class { admit() { return 0; } },
    renderTable: () => rows,
    buildPopulateRequest: () => ({}),
    readPath,
    buildRequest: () => ({}),
    renderTablePanel: () => rows,
    formatLroMetadata: () => "",
  };
}

const CTX = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };

describe.each(["recordCard", "detailHeader"] as const)("%s explicit URL ValueLink", (shape) => {
  it.each(["resolved", "no-resolver", "declined", "empty-href", "blank-kind", "absent-link"] as const)("handles %s without an unintended destination", async (scenario) => {
    const raw = "https://example.com/raw";
      const display = {
        type: ValueType.URL,
        link: scenario === "absent-link" ? undefined : { targetKind: scenario === "blank-kind" ? " " : "build" },
      };
      const populate = { service: "acme.Builds", method: "GetBuild" };
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "value-link",
        body: shape === "recordCard"
          ? { case: shape, value: { populate, fields: [{ fieldId: "value", display }] } }
          : { case: shape, value: { populate, descriptorRows: [{ sourcePath: "value", display }] } },
      });
      const resolver = vi.fn(() => scenario === "declined" ? undefined : scenario === "empty-href" ? "" : "/host-selected");
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith([]), root, descriptor, context: CTX,
      invoker: { invoke: async () => ({ value: raw }) },
      resolveHref: scenario === "no-resolver" ? undefined : resolver,
    });
    const link = root.querySelector("a");
    expect(root.textContent).toContain(raw);
    if (scenario === "resolved") {
      expect(link?.getAttribute("href")).toBe("/host-selected");
      expect(link?.getAttribute("target")).toBeNull();
    } else if (scenario === "absent-link") {
      expect(link?.getAttribute("href")).toBe(raw);
      expect(link?.getAttribute("target")).toBe("_blank");
    } else expect(link).toBeNull();
    if (["no-resolver", "blank-kind", "absent-link"].includes(scenario)) {
      expect(resolver).not.toHaveBeenCalled();
    } else expect(resolver).toHaveBeenCalledWith({ targetKind: "build", id: raw, row: { value: raw } });
  });
});

// xterm needs browser APIs jsdom does not implement. Installed once, at module
// scope, so the StreamPanel tests exercise the TERMINAL path a browser takes
// rather than the fallback.
if (typeof window.matchMedia !== "function") {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
}

describe("TablePanel row selection + actions", () => {
  it("preserves semantic selection and feedback through failure, retry, and refresh", async () => {
    const root = document.createElement("div");
    // The normalizer resolves generated aria-describedby IDs against the document.
    document.body.appendChild(root);
    const refreshedRows: RenderedRow[] = [
      { raw: { name: "new-build", repo: "fastverk/updated", phase: "Succeeded" }, cells: ["fastverk/updated", "Succeeded"] },
    ];
    const attempts: Array<{ resolve: (value: object) => void; reject: (reason: Error) => void }> = [];
    const invoke = vi.fn((_service: string, method: string, _request: object): Promise<object> => {
      if (method === "ListBuilds") return Promise.resolve({});
      return new Promise((resolve, reject) => attempts.push({ resolve, reject }));
    });
    let renders = 0;
    // Verify the wire request and raw selection handed to the WASM seam. This
    // double supplies the resolved request; it does not test Rust binding evaluation.
    const buildRequest = vi.fn((bytes: Uint8Array, context: Parameters<UiviewWasm["buildRequest"]>[1]) => {
      const rpc = fromBinary(RpcCallSchema, bytes);
      expect(rpc.service).toBe("acme.Builds");
      expect(rpc.method).toBe("ListBuildTargets");
      expect(rpc.bindings).toHaveLength(1);
      expect(rpc.bindings[0].requestField).toBe("name");
      expect(rpc.bindings[0].source).toEqual({ case: "rowField", value: "name" });
      expect(context.selectedRow).toEqual(ROWS[1].raw);
      return { name: readPath(context.selectedRow!, "name") };
    });
    try {
      await renderPanel({
        root, descriptor: tableWithActionsFixture, context: CTX,
        wasm: { ...wasmWith(ROWS), renderTable: () => ++renders === 1 ? ROWS : refreshedRows, buildRequest },
        admission: { mutations: ["acme.Builds/ListBuildTargets", "acme.Builds/ListBuildArtifacts"] },
        invoker: { invoke },
      });
      const [targets, artifacts] = [...root.querySelectorAll<HTMLButtonElement>(".meridian-uiview-actions button")];
      const rows = [...root.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]")];
      const snapshot = (state: string) => expect(normalizeDom(root)).toMatchSnapshot(`web-components/table-row-actions/${state}`);
      const selection = () => [...root.querySelectorAll("tbody tr[data-row]")].map(row => row.getAttribute("aria-selected"));

      expect([targets.textContent, artifacts.textContent]).toEqual(["Targets", "Artifacts"]);
      expect([targets.disabled, artifacts.disabled]).toEqual([true, true]);
      expect(selection()).toEqual(["false", "false"]);
      snapshot("unselected");
      targets.click();
      expect(buildRequest).not.toHaveBeenCalled();

      rows[0].click();
      expect([targets.disabled, artifacts.disabled]).toEqual([false, true]);
      expect(selection()).toEqual(["true", "false"]);
      snapshot("selected-filtered");

      expect(rows[1].tabIndex).toBe(0);
      rows[1].focus();
      rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(document.activeElement).toBe(rows[1]);
      expect([targets.disabled, artifacts.disabled]).toEqual([false, false]);
      expect(selection()).toEqual(["false", "true"]);
      snapshot("selected-enabled");

      targets.click();
      await vi.waitFor(() => expect(attempts).toHaveLength(1));
      expect(targets.disabled).toBe(true);
      expect(targets.getAttribute("aria-busy")).toBe("true");
      snapshot("pending");
      targets.click();
      expect(invoke).toHaveBeenCalledTimes(2); // Initial read and one mutation.

      attempts[0].reject(new Error("<b>Targets unavailable</b>"));
      await vi.waitFor(() => expect(targets.disabled).toBe(false));
      expect(root.querySelector('[role="alert"]')?.textContent).toBe("<b>Targets unavailable</b>");
      expect(root.querySelector('[role="alert"] b')).toBeNull();
      expect(targets.hasAttribute("aria-busy")).toBe(false);
      expect(selection()).toEqual(["false", "true"]);
      expect(renders).toBe(1); // Failure must not refresh away the selected row.
      snapshot("failed");

      targets.click();
      await vi.waitFor(() => expect(attempts).toHaveLength(2));
      expect(targets.disabled).toBe(true);
      expect(targets.getAttribute("aria-busy")).toBe("true");
      expect(root.querySelector('[role="alert"]')?.textContent).toBe("");
      snapshot("retry-pending");

      attempts[1].resolve({});
      await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toBe("Completed."));
      expect(buildRequest).toHaveBeenCalledTimes(2);
      expect(invoke.mock.calls).toEqual([
        ["acme.Builds", "ListBuilds", {}],
        ["acme.Builds", "ListBuildTargets", { name: "badge-def" }],
        ["acme.Builds", "ListBuildTargets", { name: "badge-def" }],
        ["acme.Builds", "ListBuilds", {}],
      ]);
      expect(renders).toBe(2);
      expect(root.querySelector("tbody")?.textContent).toBe("fastverk/updatedSucceeded");
      expect(selection()).toEqual(["false"]); // Removed selection cannot target the replacement row.
      expect([targets.disabled, artifacts.disabled]).toEqual([true, true]);
      expect(targets.hasAttribute("aria-busy")).toBe(false);
      expect(root.querySelector('[role="alert"]')).toBeNull();
      snapshot("completed-refreshed");
      targets.click();
      expect(invoke).toHaveBeenCalledTimes(4);
    } finally {
      disposePanel(root);
      root.remove();
    }
  });

  it("reports a failed row action and refreshes after retry", async () => {
    const root = document.createElement("div");
    let mutations = 0;
    let reads = 0;
    const populate = tableWithActionsFixture.body.case === "table" ? tableWithActionsFixture.body.value.populate! : null!;
    await renderPanel({ root, wasm: wasmWith(ROWS), descriptor: tableWithActionsFixture, context: CTX,
      admission: "unrestricted", invoker: { invoke: async (_service, method) => {
        if (method === populate.method) { reads++; return {}; }
        if (++mutations === 1) throw new Error("Try again");
        return {};
      } },
    });
    root.querySelector("tbody tr[data-row]")!.dispatchEvent(new Event("click", { bubbles: true }));
    const button = root.querySelector<HTMLButtonElement>(".meridian-uiview-actions button")!;
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("Try again");
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mutations).toBe(2);
    expect(reads).toBe(2);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Completed.");
  });
  it("renders a button per RowAction, all disabled until a row is selected", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith(ROWS),
      root,
      descriptor: tableWithActionsFixture,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
    });
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".meridian-uiview-actions button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Targets", "Artifacts"]);
    // Nothing selected ⇒ nothing actionable. This is the RESTING state.
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("honours enabled_when: selecting a row enables only the actions that match it", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith(ROWS),
      root,
      descriptor: tableWithActionsFixture,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
    });
    const [targets, artifacts] = [
      ...root.querySelectorAll<HTMLButtonElement>(".meridian-uiview-actions button"),
    ];
    const rows = root.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]");

    // Row 0 is phase=Building — "Artifacts" is gated on Succeeded.
    rows[0].dispatchEvent(new Event("click", { bubbles: true }));
    expect(targets.disabled).toBe(false);
    expect(artifacts.disabled).toBe(true);
    expect(rows[0].getAttribute("aria-selected")).toBe("true");

    // Row 1 is phase=Succeeded — both apply.
    rows[1].dispatchEvent(new Event("click", { bubbles: true }));
    expect(targets.disabled).toBe(false);
    expect(artifacts.disabled).toBe(false);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    expect(rows[0].getAttribute("aria-selected")).toBe("false");
  });

  it("fires the action's RPC with the SELECTED row in context, then re-fetches", async () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    let seenSelectedRow: unknown = null;
    await renderPanel({
      wasm: {
        ...wasmWith(ROWS),
        // buildRequest is where the selected row reaches a row-action binding.
        buildRequest: (_rpc, context) => {
          seenSelectedRow = context.selectedRow;
          return {};
        },
      },
      root,
      descriptor: tableWithActionsFixture,
      invoker: {
        invoke: async (service, method) => {
          calls.push(`${service}/${method}`);
          return { builds: [] };
        },
      },
      context: CTX,
      admission: { mutations: ["acme.Builds/ListBuildTargets"] },
    });
    calls.length = 0; // drop the initial populate

    const rows = root.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]");
    rows[1].dispatchEvent(new Event("click", { bubbles: true }));
    const targets = root.querySelector<HTMLButtonElement>(".meridian-uiview-actions button");
    targets?.dispatchEvent(new Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(seenSelectedRow).toEqual(ROWS[1].raw);
    // The action, then the re-fetch (RowAction.refresh_on_success).
    expect(calls).toEqual(["acme.Builds/ListBuildTargets", "acme.Builds/ListBuilds"]);
  });

  it("does not make rows selectable when the table declares no actions", async () => {
    // A real message, not a structural clone — renderPanel serializes the
    // descriptor with toBinary, which needs the schema intact.
    const noActions = create(PanelDescriptorSchema, {
      panelId: "builds",
      title: "Builds",
      body: {
        case: "table",
        value: {
          populate: { service: "acme.Builds", method: "ListBuilds" },
          rowsField: "builds",
          columns: [{ header: "Repo", fieldPath: "repo" }],
        },
      },
    });
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith(ROWS),
      root,
      descriptor: noActions,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
    });
    expect(root.querySelector(".meridian-uiview-actions")).toBeNull();
    expect(root.querySelector("tbody tr[tabindex]")).toBeNull();
  });
});

describe("TableColumn.link (the resolveHref seam)", () => {
  it("asks the host for the destination, passing the target kind, cell value and raw row", async () => {
    const root = document.createElement("div");
    const seen: Array<{ targetKind: string; id: string; row?: object }> = [];
    await renderPanel({
      wasm: wasmWith(ROWS),
      root,
      descriptor: tableWithActionsFixture,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
      // The host routes by the ROW's id, not the displayed cell — which is why
      // the seam carries the row at all.
      resolveHref: (o) => {
        seen.push(o);
        return `#/builds/${(o.row as { name: string }).name}`;
      },
    });
    expect(seen[0].targetKind).toBe("acme.Build");
    expect(seen[0].id).toBe("fastverk/botnoc");
    const links = [...root.querySelectorAll<HTMLAnchorElement>("tbody a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#/builds/botnoc-abc",
      "#/builds/badge-def",
    ]);
    // Only the linked column is a link; the other cell stays plain text.
    expect(root.querySelectorAll("tbody tr")[0].children[1].querySelector("a")).toBeNull();
  });

  it("draws plain text — never a dead link — when no host resolver is wired", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith(ROWS),
      root,
      descriptor: tableWithActionsFixture,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
    });
    expect(root.querySelectorAll("tbody a").length).toBe(0);
    expect(root.querySelectorAll("tbody tr")[0].children[0].textContent).toBe("fastverk/botnoc");
  });

  it("draws plain text when the resolver declines (returns nothing)", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith(ROWS),
      root,
      descriptor: tableWithActionsFixture,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
      resolveHref: () => null,
    });
    expect(root.querySelectorAll("tbody a").length).toBe(0);
  });
});

describe("wasm `raw` arrives as a Map (serde-wasm-bindgen's default)", () => {
  // This is not hypothetical. serde-wasm-bindgen maps a serde_json Object to a JS
  // **Map** unless `serialize_maps_as_objects` is set, so `raw.name` is undefined
  // while `raw.get("name")` works — silently. It shipped: every build link in the
  // fastverk console pointed at a repo name instead of a build id, because
  // resolveHref read `row[idField]`, got undefined, and fell back to the cell.
  const mapRows: RenderedRow[] = [
    {
      raw: new Map([["name", "botnoc-abc"], ["repo", "fastverk/botnoc"], ["phase", "Succeeded"]]) as unknown as Record<string, unknown>,
      cells: ["fastverk/botnoc", "Succeeded"],
    },
  ];

  it("hands resolveHref a PLAIN object, so row[idField] resolves", async () => {
    const root = document.createElement("div");
    let seenRow: Record<string, unknown> | undefined;
    await renderPanel({
      wasm: wasmWith(mapRows),
      root,
      descriptor: tableWithActionsFixture,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
      resolveHref: (o) => {
        seenRow = o.row as Record<string, unknown>;
        return `#/builds/${(o.row as { name?: string }).name}`;
      },
    });
    expect(seenRow instanceof Map).toBe(false);
    expect(seenRow?.name).toBe("botnoc-abc");
    // The regression itself: the href must key on the row id, not the cell text.
    expect(root.querySelector("tbody a")?.getAttribute("href")).toBe("#/builds/botnoc-abc");
  });

  it("hands the action's context a PLAIN selected row", async () => {
    const root = document.createElement("div");
    let seenSelected: unknown;
    await renderPanel({
      wasm: {
        ...wasmWith(mapRows),
        buildRequest: (_rpc, context) => {
          seenSelected = context.selectedRow;
          return {};
        },
      },
      root,
      descriptor: tableWithActionsFixture,
      invoker: { invoke: async () => ({ builds: [] }) },
      context: CTX,
    });
    root.querySelector<HTMLTableRowElement>("tbody tr[data-row]")
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".meridian-uiview-actions button")
      ?.dispatchEvent(new Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(seenSelected instanceof Map).toBe(false);
    expect((seenSelected as { name?: string })?.name).toBe("botnoc-abc");
  });
});

describe("wasm-built REQUESTS must reach the host as plain objects", () => {
  // The damaging half of the Map problem. A request goes straight to the host's
  // RpcInvoker, and hosts do the obvious things with it:
  //   JSON.stringify(new Map([["name","x"]]))  === "{}"
  //   Object.entries(new Map([["name","x"]]))  === []
  // So every binding-populated request silently serialized to NOTHING. Observed
  // live: a build's log stream subscribed with no build name, and every
  // per-build table came back empty because the id never left the page.
  const mapRequest = () =>
    new Map<string, unknown>([
      ["name", "botnoc-abc"],
      ["page", new Map<string, unknown>([["limit", 50]])], // NestedBinding ⇒ nested Map
    ]) as unknown as object;

  it("normalizes a table's populate request, deeply", async () => {
    const root = document.createElement("div");
    let seen: unknown;
    await renderPanel({
      wasm: { ...wasmWith(ROWS), buildPopulateRequest: mapRequest },
      root,
      descriptor: tableWithActionsFixture,
      invoker: {
        invoke: async (_s, _m, request) => {
          seen = request;
          return { builds: [] };
        },
      },
      context: CTX,
    });
    expect(seen instanceof Map).toBe(false);
    expect(seen).toEqual({ name: "botnoc-abc", page: { limit: 50 } });
    // The failure this guards: a Map stringifies to "{}" and enumerates to [].
    expect(JSON.stringify(seen)).toContain("botnoc-abc");
    expect(Object.entries(seen as object).length).toBe(2);
  });

  it("normalizes a StreamPanel's subscribe request", async () => {
    let seenRequest: unknown;
    const invoker: StreamInvoker = {
      subscribe: (_s, _m, request) => {
        seenRequest = request;
        return { close: () => {} };
      },
    };
    const root = document.createElement("div");
    await renderPanel({
      wasm: { ...wasmWith([]), buildRequest: mapRequest },
      root,
      descriptor: streamFixture,
      invoker: { invoke: async () => ({}) },
      streamInvoker: invoker,
      context: CTX,
    });
    expect(seenRequest instanceof Map).toBe(false);
    expect((seenRequest as { name?: string }).name).toBe("botnoc-abc");
  });
});

describe("DetailHeaderPanel", () => {
  const headerFixture = create(PanelDescriptorSchema, {
    panelId: "build_header",
    title: "Build",
    body: {
      case: "detailHeader",
      value: {
        titleSourcePath: "repo",
        subtitleSourcePath: "message",
        statusSourcePath: "phase",
        descriptorRows: [
          { label: "Ref", sourcePath: "ref" },
          { label: "Team", sourcePath: "team" },
        ],
        populate: { service: "acme.Builds", method: "GetBuild" },
        idField: "name",
      },
    },
  });

  it("fetches one record with the SUBJECT bound into id_field, and renders it", async () => {
    const root = document.createElement("div");
    let seenRequest: object | undefined;
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: headerFixture,
      invoker: {
        invoke: async (_s, _m, request) => {
          seenRequest = request;
          return { repo: "fastverk/botnoc", phase: "Succeeded", message: "build ok", ref: "main", team: "" };
        },
      },
      // The host's detail subject travels as currentResourcePath.
      context: { ...CTX, currentResourcePath: "botnoc-abc" },
    });
    expect(seenRequest).toEqual({ name: "botnoc-abc" });
    expect(root.querySelector(".meridian-uiview-record-title")?.textContent).toBe("fastverk/botnoc");
    expect(root.querySelector(".meridian-uiview-record-status")?.textContent).toBe("Succeeded");
    expect(root.querySelector<HTMLElement>(".meridian-uiview-record-status")?.dataset.status).toBe("succeeded");
    expect(root.querySelector(".meridian-uiview-record-subtitle")?.textContent).toBe("build ok");
    const rows = [...root.querySelectorAll(".meridian-uiview-record-rows > *")].map((n) => n.textContent);
    // An empty value keeps its label and shows an em dash — "nobody set a team"
    // is information; a missing row reads as a schema that never had the field.
    expect(rows).toEqual(["Ref", "main", "Team", "—"]);
  });

  it("does not blank authored copy when the title path resolves to nothing", async () => {
    const withLiteral = create(PanelDescriptorSchema, {
      panelId: "h",
      title: "Build",
      body: {
        case: "detailHeader",
        value: { title: "Untitled build", titleSourcePath: "repo", populate: { service: "acme.Builds", method: "GetBuild" } },
      },
    });
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: withLiteral,
      invoker: { invoke: async () => ({}) },
      context: CTX,
    });
    expect(root.querySelector(".meridian-uiview-record-title")?.textContent).toBe("Untitled build");
  });
});

describe("StreamPanel renders as a read-only terminal when it can", () => {
  // xterm reads browser APIs off the element's OWNER WINDOW, so the host element
  // must actually be in the document — a detached div is why an earlier version
  // of this test saw the fallback. Polyfills are installed at module scope
  // (jsdom implements neither fully) and the root is attached, which is also the
  // shape a real panel has.
  function attachedRoot(): HTMLElement {
    const root = document.createElement("div");
    document.body.appendChild(root);
    return root;
  }

  function fakeStream() {
    let handlers: Parameters<StreamInvoker["subscribe"]>[3] | null = null;
    return {
      invoker: {
        subscribe: (_s: string, _m: string, _r: object, h: typeof handlers) => {
          handlers = h;
          return { close: () => {} };
        },
      } as unknown as StreamInvoker,
      emit: (frame: string | object) => handlers?.onFrame(frame),
    };
  }

  it("mounts a terminal on the first line, not before", async () => {
    const stream = fakeStream();
    const root = attachedRoot();
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: streamFixture,
      invoker: { invoke: async () => ({}) },
      streamInvoker: stream.invoker,
      context: CTX,
    });
    // Idle stream: the placeholder alone. An idle build should look idle, not
    // show a placeholder sitting above an empty terminal.
    expect(root.querySelector(".meridian-uiview-placeholder")).not.toBeNull();
    expect(root.querySelector(".meridian-uiview-log-terminal")).toBeNull();

    stream.emit({ line: "INFO: Analyzed 2 targets" });
    expect(root.querySelector(".meridian-uiview-placeholder")).toBeNull();
    expect(root.querySelector(".meridian-uiview-log-terminal")).not.toBeNull();
    // The outer pane must stop scrolling once the terminal owns scrolling, or
    // there are two nested scrollbars and the tail fights the wrapper.
    expect(
      root.querySelector(".meridian-uiview-stream")?.classList.contains(
        "meridian-uiview-stream-term",
      ),
    ).toBe(true);
    // Read-only: the plain per-line DOM is NOT used, and no session input path
    // was created — stdin is disabled in renderLogTerminal by construction.
    expect(root.querySelector(".meridian-uiview-stream-line")).toBeNull();
    root.remove();
  });

  it("closes the terminal on dispose", async () => {
    const stream = fakeStream();
    const root = attachedRoot();
    const opts = {
      wasm: wasmWith([]),
      root,
      descriptor: streamFixture,
      invoker: { invoke: async () => ({}) },
      streamInvoker: stream.invoker,
      context: CTX,
    };
    await renderPanel(opts);
    stream.emit({ line: "one" });
    expect(root.querySelector(".meridian-uiview-log-terminal")).not.toBeNull();
    // Re-rendering the same container must not strand the terminal's observers.
    await renderPanel(opts);
    expect(root.querySelectorAll(".meridian-uiview-log-terminal").length).toBe(0);
    root.remove();
  });
});

// These assert the FALLBACK pane — the path a surface without xterm's browser
// APIs takes. It still ships and still has to be correct, so it is tested
// deliberately rather than left as whatever jsdom happens to do: matchMedia is
// removed for this block and restored after.
describe("StreamPanel (plain-pane fallback)", () => {
  const saved = window.matchMedia;
  beforeAll(() => {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  });
  afterAll(() => {
    (window as unknown as Record<string, unknown>).matchMedia = saved;
  });

  function fakeStream() {
    let handlers: Parameters<StreamInvoker["subscribe"]>[3] | null = null;
    let closed = 0;
    const invoker: StreamInvoker = {
      subscribe: (_s, _m, _r, h) => {
        handlers = h;
        return { close: () => { closed += 1; } };
      },
    };
    return {
      invoker,
      emit: (frame: string | object) => handlers?.onFrame(frame),
      fail: (msg: string) => handlers?.onError?.(new Error(msg)),
      end: () => handlers?.onClose?.(),
      closedCount: () => closed,
    };
  }

  async function draw(stream: ReturnType<typeof fakeStream> | null) {
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: streamFixture,
      invoker: { invoke: async () => ({}) },
      streamInvoker: stream?.invoker,
      context: CTX,
    });
    return root;
  }

  it("shows the placeholder until the first line, then replaces it", async () => {
    const stream = fakeStream();
    const root = await draw(stream);
    expect(root.querySelector(".meridian-uiview-placeholder")?.textContent).toBe(
      "Waiting for the build to start…",
    );
    stream.emit({ line: "INFO: Analyzed 2 targets" });
    expect(root.querySelector(".meridian-uiview-placeholder")).toBeNull();
    expect(root.querySelector(".meridian-uiview-stream-line")?.textContent).toBe(
      "INFO: Analyzed 2 targets",
    );
  });

  it("selects the text via line_field, and accepts a bare-string frame too", async () => {
    const stream = fakeStream();
    const root = await draw(stream);
    stream.emit({ line: "structured" });
    stream.emit("bare");
    const lines = [...root.querySelectorAll(".meridian-uiview-stream-line")].map((l) => l.textContent);
    expect(lines).toEqual(["structured", "bare"]);
  });

  it("shows an uninterpretable frame as JSON rather than [object Object]", async () => {
    const stream = fakeStream();
    const root = await draw(stream);
    stream.emit({ unexpected: "shape" });
    expect(root.querySelector(".meridian-uiview-stream-line")?.textContent).toBe(
      '{"unexpected":"shape"}',
    );
  });

  it("bounds retention at max_lines, dropping from the front", async () => {
    const stream = fakeStream();
    const root = await draw(stream);
    for (const n of [1, 2, 3, 4, 5]) stream.emit({ line: `line ${n}` });
    const lines = [...root.querySelectorAll(".meridian-uiview-stream-line")].map((l) => l.textContent);
    expect(lines).toEqual(["line 3", "line 4", "line 5"]); // max_lines = 3
    // The COUNT is cumulative — retention is a display bound, not a miscount.
    expect(root.querySelector(".meridian-uiview-meta")?.textContent).toBe("5 lines");
  });

  it("surfaces a stream failure in the meta line instead of blanking", async () => {
    const stream = fakeStream();
    const root = await draw(stream);
    stream.emit({ line: "one" });
    stream.fail("upstream gone");
    expect(root.querySelector(".meridian-uiview-meta")?.textContent).toBe(
      "1 lines — stream failed: upstream gone",
    );
    expect(root.querySelector(".meridian-uiview-stream-line")?.textContent).toBe("one");
  });

  it("degrades to the placeholder when the surface has no stream transport", async () => {
    const root = await draw(null);
    expect(root.querySelector(".meridian-uiview-placeholder")?.textContent).toBe(
      "Waiting for the build to start…",
    );
    expect(root.querySelector(".meridian-uiview-meta")?.textContent).toBe(
      "not live on this surface",
    );
  });

  it("closes the subscription on dispose, and on a re-render of the same container", async () => {
    const stream = fakeStream();
    const root = document.createElement("div");
    const opts = {
      wasm: wasmWith([]),
      root,
      descriptor: streamFixture,
      invoker: { invoke: async () => ({}) },
      streamInvoker: stream.invoker,
      context: CTX,
    };
    await renderPanel(opts);
    expect(stream.closedCount()).toBe(0);

    // Re-rendering the same container must not strand the old subscription.
    await renderPanel(opts);
    expect(stream.closedCount()).toBe(1);

    disposePanel(root);
    expect(stream.closedCount()).toBe(2);
    // Disposal is idempotent.
    disposePanel(root);
    expect(stream.closedCount()).toBe(2);
  });
});

describe("populate on StatPanel / GrammarPanel (schemas 0.19.0)", () => {
  // Before this, a StatPanel's value was frozen when the descriptor was authored
  // — for a compiled bundle, at IMAGE-BUILD TIME. Producers worked around it by
  // drawing KPI strips as Vega text-marks over a data.url, trading a full-parity
  // shape for a web-only chart pretending to be text.
  const statPanel = create(PanelDescriptorSchema, {
    panelId: "targets",
    title: "Targets",
    body: {
      case: "stat",
      value: {
        label: "Targets done",
        value: 0, // the pre-fetch placeholder
        populate: { service: "acme.Builds", method: "BuildKpis" },
        valueField: "done",
        previousField: "prior",
        seriesField: "history",
      },
    },
  });

  it("fills value/previous/series from the fetch, and still COMPUTES the delta", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: statPanel,
      invoker: { invoke: async () => ({ done: 42, prior: 30, history: [10, 20, 30, 42] }) },
      context: CTX,
    });
    expect(root.querySelector(".mer-stat-value")?.textContent).toContain("42");
    // 42 − 30 = 12, computed from the DATA. The whole point of this shape is
    // that direction is never taken from the wire, and a fetch must not become
    // a way around that.
    expect(root.querySelector(".mer-stat-delta")?.textContent).toContain("12");
    expect(root.querySelector<HTMLElement>(".mer-stat")?.dataset.trend).toBe("up");
    expect(root.querySelector(".mer-stat-spark")).not.toBeNull();
  });

  it("falls back to the authored value when populate fails, and says so", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: statPanel,
      invoker: { invoke: async () => { throw new Error("upstream down"); } },
      context: CTX,
    });
    // The authored value is documented as the pre-fetch placeholder, so falling
    // back to it beats blanking the tile — but the failure must be visible.
    expect(root.querySelector(".mer-stat-value")?.textContent).toContain("0");
    expect(root.querySelector(".meridian-uiview-meta")?.textContent).toContain("upstream down");
  });

  it("gives a grammar's transcoder the FETCHED data, preferring it over inline", async () => {
    const grammarPanel = create(PanelDescriptorSchema, {
      panelId: "graph",
      title: "Graph",
      body: {
        case: "grammar",
        value: {
          language: 4, // graphviz
          source: "digraph { a -> b }",
          populate: { service: "acme.Builds", method: "BuildTargets" },
        },
      },
    });
    const root = document.createElement("div");
    let seenData: unknown;
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: grammarPanel,
      invoker: { invoke: async () => ({ targets: [{ label: "//a" }] }) },
      context: CTX,
      renderGrammar: ({ data }) => {
        seenData = data;
        const d = document.createElement("div");
        d.className = "rendered";
        return d;
      },
    });
    expect(seenData).toEqual({ targets: [{ label: "//a" }] });
    expect(root.querySelector(".rendered")).not.toBeNull();
  });

  it("renders a populate-less panel exactly as before", async () => {
    const staticStat = create(PanelDescriptorSchema, {
      panelId: "s",
      title: "S",
      body: { case: "stat", value: { label: "Churn", value: 5 } },
    });
    const root = document.createElement("div");
    let called = false;
    await renderPanel({
      wasm: wasmWith([]),
      root,
      descriptor: staticStat,
      invoker: { invoke: async () => { called = true; return {}; } },
      context: CTX,
    });
    expect(called).toBe(false); // no fetch at all
    expect(root.querySelector(".mer-stat-value")?.textContent).toContain("5");
  });

  describe("record panels and declared ValueDisplay", () => {
    for (const shape of ["recordCard", "detailHeader"] as const) {
      it(`${shape} preserves principal labels and requires a host-approved destination`, async () => {
        for (const scenario of ["principal", "email", "no-resolver", "declined", "empty-href", "no-kind", "disabled"] as const) {
          const raw = "Ruchi Sharma <ruchi@example.com>";
          const display = {
            type: scenario === "email" ? ValueType.EMAIL : ValueType.PRINCIPAL,
            options: { case: "principal" as const, value: {
              display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE,
              linkToRecord: scenario !== "disabled",
              targetKind: scenario === "no-kind" ? "" : "identity.user",
            } },
          };
          const populate = { service: "acme.Builds", method: "GetBuild" };
          const descriptor = create(PanelDescriptorSchema, {
            panelId: "principal",
            body: shape === "recordCard"
              ? { case: shape, value: { populate, fields: [{ fieldId: "owner", display }] } }
              : { case: shape, value: { populate, descriptorRows: [{ sourcePath: "owner", display }] } },
          });
          const resolveHref = vi.fn(() => scenario === "declined" ? null : scenario === "empty-href" ? "" : "/people/host-selected");
          const invoke = vi.fn(async () => ({ owner: raw }));
          const root = document.createElement("div");
          await renderPanel({ wasm: wasmWith([]), root, descriptor, invoker: { invoke }, context: CTX,
            resolveHref: scenario === "no-resolver" ? undefined : resolveHref });
          expect(root.querySelector("dd")?.getAttribute("title")).toBe("ruchi@example.com");
          expect(root.querySelector("dd")?.textContent).toBe("Ruchi Sharma");
          if (scenario === "principal" || scenario === "email") {
            expect(root.querySelector("a")?.getAttribute("href")).toBe("/people/host-selected");
            expect(root.querySelector("a")?.getAttribute("target")).toBeNull();
          } else expect(root.querySelector("a")).toBeNull();
          if (["no-resolver", "no-kind", "disabled"].includes(scenario)) {
            expect(resolveHref).not.toHaveBeenCalled();
          } else expect(resolveHref).toHaveBeenCalledWith({ targetKind: "identity.user", id: raw, row: { owner: raw } });
          expect(invoke).toHaveBeenCalledTimes(1); // Populate is the only RPC.
        }
      });
    }

    it("formats declared boolean and numeric values in the detail header", async () => {
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "build-header",
        body: {
          case: "detailHeader",
          value: create(DetailHeaderPanelSchema, {
            title: "Build 42",
            populate: { service: "acme.Builds", method: "GetBuild" },
            descriptorRows: [
              { label: "Healthy", sourcePath: "healthy", display: { type: ValueType.BOOLEAN } },
              { label: "Score", sourcePath: "score", display: { type: ValueType.DECIMAL, options: { case: "number", value: { fractionDigits: 2 } } } },
              { label: "Posted", sourcePath: "posted", display: { type: ValueType.DATE_TIME, options: { case: "temporal", value: { display: TemporalDisplay.RELATIVE_WITH_ABSOLUTE_TITLE } } } },
              { label: "Owner", sourcePath: "owner", display: { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
            ],
          }),
        },
      });
      const root = document.createElement("div");
      await renderPanel({
        wasm: wasmWith([]),
        root,
        descriptor,
        invoker: { invoke: async () => ({ healthy: true, score: 1.236, posted: new Date(Date.now() - 2 * 86_400_000).toISOString(), owner: "Ruchi Sharma <ruchi@example.com>" }) },
        context: CTX,
      });

      expect(root.querySelector(".meridian-uiview-record-rows")?.textContent).toContain("HealthyYes");
      expect(root.querySelector(".meridian-uiview-record-rows")?.textContent).toContain("Score1.24");
      const posted = [...root.querySelectorAll<HTMLElement>(".meridian-uiview-record-rows dd")]
        .find((dd) => dd.title.includes("UTC"));
      expect(posted?.textContent).toContain("days ago");
      expect(posted?.title).toContain("UTC");
      const owner = [...root.querySelectorAll<HTMLElement>(".meridian-uiview-record-rows dd")]
        .find((dd) => dd.title === "ruchi@example.com");
      expect(owner?.textContent).toContain("Ruchi Sharma");
      expect(owner?.title).toBe("ruchi@example.com");
    });

    it("formats declared values in the record card", async () => {
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "build-card",
        body: {
          case: "recordCard",
          value: create(RecordCardPanelSchema, {
            populate: { service: "acme.Builds", method: "GetBuild" },
            fields: [
              { fieldId: "healthy", label: "Healthy", display: { type: ValueType.BOOLEAN } },
              { fieldId: "score", label: "Score", display: { type: ValueType.DECIMAL, options: { case: "number", value: { fractionDigits: 2 } } } },
            ],
          }),
        },
      });
      const root = document.createElement("div");
      await renderPanel({
        wasm: wasmWith([]),
        root,
        descriptor,
        invoker: { invoke: async () => ({ healthy: true, score: 1.236 }) },
        context: CTX,
      });

      expect(root.querySelector(".meridian-uiview-record-rows")?.textContent).toContain("HealthyYes");
      expect(root.querySelector(".meridian-uiview-record-rows")?.textContent).toContain("Score1.24");
    });

    it("renders only safe declared URL values as links", async () => {
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "link-card",
        body: {
          case: "recordCard",
          value: create(RecordCardPanelSchema, {
            populate: { service: "acme.Builds", method: "GetBuild" },
            fields: [{ fieldId: "url", label: "URL", display: { type: ValueType.URL } }],
          }),
        },
      });
      const renderValue = async (url: string) => {
        const root = document.createElement("div");
        await renderPanel({
          wasm: wasmWith([]),
          root,
          descriptor,
          invoker: { invoke: async () => ({ url }) },
          context: CTX,
        });
        return root;
      };

      const safe = await renderValue("https://example.com/docs");
      expect(safe.querySelector<HTMLAnchorElement>("a")?.href).toBe("https://example.com/docs");
      const unsafe = await renderValue("javascript:alert(1)");
      expect(unsafe.querySelector("a")).toBeNull();
      expect(unsafe.textContent).toContain("javascript:alert(1)");
    });

    it("uses the host resolver for declared principal record links", async () => {
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "principal-link-card",
        body: {
          case: "recordCard",
          value: create(RecordCardPanelSchema, {
            populate: { service: "acme.Builds", method: "GetBuild" },
            fields: [{
              fieldId: "ownerId",
              label: "Owner",
              display: {
                type: ValueType.PRINCIPAL,
                options: { case: "principal", value: { linkToRecord: true, targetKind: "identity.user" } },
              },
            }],
          }),
        },
      });
      const root = document.createElement("div");
      await renderPanel({
        wasm: wasmWith([]),
        root,
        descriptor,
        invoker: { invoke: async () => ({ ownerId: "user_123" }) },
        context: CTX,
        resolveHref: ({ targetKind, id }) => `/directory/${targetKind}/${id}`,
      });
      const link = root.querySelector<HTMLAnchorElement>("a");
      expect(link?.textContent).toBe("user_123");
      expect(link?.getAttribute("href")).toBe("/directory/identity.user/user_123");
      expect(link?.target).toBe("");
    });

    it("uses the host resolver for a general ValueLink", async () => {
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "build-link-card",
        body: {
          case: "recordCard",
          value: create(RecordCardPanelSchema, {
            populate: { service: "acme.Builds", method: "GetBuild" },
            fields: [{
              fieldId: "buildId",
              label: "Build",
              display: { type: ValueType.IDENTIFIER, link: { targetKind: "build" } },
            }],
          }),
        },
      });
      const root = document.createElement("div");
      await renderPanel({
        wasm: wasmWith([]),
        root,
        descriptor,
        invoker: { invoke: async () => ({ buildId: "build_123" }) },
        context: CTX,
        resolveHref: ({ targetKind, id }) => `/builds/${targetKind}/${id}`,
      });
      const link = root.querySelector<HTMLAnchorElement>("a");
      expect(link?.textContent).toBe("build_123");
      expect(link?.getAttribute("href")).toBe("/builds/build/build_123");
      expect(link?.target).toBe("");
    });
  });
});
