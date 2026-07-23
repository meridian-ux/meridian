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

import { create, toBinary } from "@bufbuild/protobuf";
import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { beforeAll, describe, expect, it } from "vitest";

import type { UiviewWasm } from "../src/uiview/renderer.js";

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

let wasm: UiviewWasm;

beforeAll(async () => {
  const { readFileSync } = (await import(/* @vite-ignore */ "node:" + "fs")) as NodeFs;
  const glueUrl = new URL(GLUE, import.meta.url);
  const wasmUrl = new URL(WASM, import.meta.url);
  const mod = await import(glueUrl.href);
  await mod.default({ module_or_path: readFileSync(wasmUrl) });
  wasm = mod as unknown as UiviewWasm;
});

const CTX = {
  currentResourcePath: "botnoc-abc",
  uiIdentity: null,
  selectedRow: { name: "row-1", repo: "fastverk/botnoc" },
  formValues: {},
};

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
});
