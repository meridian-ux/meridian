// Browser-only test controls. Authored fixtures and fake responses arrive as
// canonical ViewDescriptor/Struct bytes, not a second transport schema.
import { create, fromBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { StreamFrameSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { htmlKit, shadcnKit, MeridianProvider, ViewRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";
import { renderView } from "../../web/src/uiview/view_renderer.js";
import { disposePanel, type UiviewWasm } from "../../web/src/uiview/renderer.js";

let reactRoot: Root | undefined;
const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const controls = {
  async render(kit: string, viewBytes: number[], responseBytes: number[]) {
    if (reactRoot) { flushSync(() => reactRoot!.unmount()); reactRoot = undefined; }
    const root = document.getElementById("root")!;
    root.querySelectorAll<HTMLElement>(".meridian-uiview-slot > div").forEach(disposePanel);
    root.replaceChildren();
    const view = fromBinary(ViewDescriptorSchema, Uint8Array.from(viewBytes));
    const responses = toJson(StructSchema, fromBinary(StructSchema, Uint8Array.from(responseBytes))) as Record<string, unknown>;
    const calls = new Set<string>();
    const invoker = { invoke: async (service: string, method: string) => {
      calls.add(`${service}.${method}`); return (responses[`${service}.${method}`] ?? {}) as object;
    } };
    const frames = (responses.__streamFrames ?? []) as object[];
    if (kit === "web-components") {
      await renderView({ root, view, wasm: window.axWasm, context, invoker,
        onPromptResponse: () => {}, streamInvoker: { subscribe: (_s, _m, _r, observer) => {
          frames.forEach(value => observer.onFrame(value)); return { close() {} };
        } },
      });
    } else {
      const selectedKit = kit === "html" ? htmlKit : kit === "shadcn" ? shadcnKit : kit === "mui-kit" ? muiKit : undefined;
      if (!selectedKit) throw new Error(`Unknown AX kit ${kit}`);
      reactRoot = createRoot(root);
      flushSync(() => reactRoot!.render(createElement(MeridianProvider, {
        kit: selectedKit, invoker, adhoc: {}, onPromptResponse: () => {},
        streamSnapshots: { [view.slots[0].panel!.panelId]: frames.map(value => create(StreamFrameSchema, { dataJson: new TextEncoder().encode(JSON.stringify(value)) })) },
        children: createElement(ViewRenderer, { view }),
      })));
    }
    await frame(); await frame();
    for (const call of Object.keys(responses).filter(key => !key.startsWith("__"))) {
      if (!calls.has(call)) throw new Error(`AX render did not consume ${call}`);
    }
    return view.title;
  },
};
declare global { interface Window { axConformance: typeof controls; axWasm: UiviewWasm } }
window.axConformance = controls;
