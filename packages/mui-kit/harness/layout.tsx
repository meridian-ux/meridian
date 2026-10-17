// Browser test seam: descriptors, context, and fake responses arrive only as
// canonical protobuf bytes. No second view schema or live transport exists here.
import { fromBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { htmlKit, shadcnKit, MeridianProvider, ViewRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";
import { disposeView, renderView } from "../../web/src/uiview/view_renderer.js";
import type { UiviewWasm } from "../../web/src/uiview/renderer.js";

let reactRoot: Root | undefined;
let calls: string[] = [];
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const struct = (bytes: number[]) => toJson(StructSchema, fromBinary(StructSchema, Uint8Array.from(bytes)));
const controls = {
  calls: () => [...calls],
  async render(kit: string, viewBytes: number[], contextBytes: number[], responseBytes: number[]) {
    const root = document.getElementById("root")!;
    if (reactRoot) { const previous = reactRoot; reactRoot = undefined; flushSync(() => previous.unmount()); }
    disposeView(root);
    root.replaceChildren();
    calls = [];
    const view = fromBinary(ViewDescriptorSchema, Uint8Array.from(viewBytes));
    const context = struct(contextBytes) as { selections?: Record<string, unknown> };
    const responses = struct(responseBytes) as Record<string, object>;
    const invoker = { invoke: async (service: string, method: string) => {
      calls.push(`${service}.${method}`);
      return responses[`${service}.${method}`] ?? {};
    } };
    if (kit === "web-components") {
      await renderView({ root, view, wasm: window.layoutWasm, invoker, context: {
        currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {}, selections: context.selections,
      } });
    } else {
      const selected = kit === "html" ? htmlKit : kit === "shadcn" ? shadcnKit : kit === "mui-kit" ? muiKit : undefined;
      if (!selected) throw new Error(`Unknown layout kit ${kit}`);
      const mounted = createRoot(root);
      reactRoot = mounted;
      // The typed provider accepts string IDs. The corpus also probes closed
      // gates for invalid externally supplied false/null/zero scope scalars.
      const values = (context.selections ?? {}) as Record<string, string>;
      flushSync(() => mounted.render(createElement(MeridianProvider, {
        kit: selected, invoker, adhoc: {},
        children: createElement(ViewRenderer, { view, selection: { values, set() {} } }),
      })));
    }
    await frame(); await frame();
    window.scrollTo(0, 0);
  },
};
declare global { interface Window { layoutConformance: typeof controls; layoutWasm: UiviewWasm } }
window.layoutConformance = controls;
