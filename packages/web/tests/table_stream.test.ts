// @vitest-environment jsdom
//
// The interactions a TablePanel has always described but this renderer used to
// drop — row selection, RowActions, ColumnLink — plus the StreamPanel shape and
// the disposal contract that keeps a live subscription from outliving its panel.
//
// These are regression tests for a specific class of bug: a descriptor field
// that is authored, shipped, and silently never drawn. fastverk's builds table
// declared three RowActions that no user could ever reach.

import { create } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it } from "vitest";

import { disposePanel, renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import type { StreamInvoker } from "@savvifi/meridian-schemas/uiview";
import { streamFixture, tableWithActionsFixture } from "./fixtures.js";

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
    renderTable: () => rows,
    buildPopulateRequest: () => ({}),
    readPath,
    buildRequest: () => ({}),
    renderTablePanel: () => rows,
    formatLroMetadata: () => "",
  };
}

const CTX = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };

describe("TablePanel row selection + actions", () => {
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
    new Map([
      ["name", "botnoc-abc"],
      ["page", new Map([["limit", 50]])], // NestedBinding ⇒ nested Map
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

describe("StreamPanel", () => {
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
