// The reference WebRenderer: meridian's built-in web-components renderer,
// adapted to the seam. It is React-free — proof the seam is not anchored to any
// web framework.
//
// It is also the one place that bridges the canonical type representation to the
// legacy wasm boundary: the seam speaks the protobuf-es `PanelDescriptor`
// (camelCase message), while the Rust uiview wasm core (prost + serde) consumes
// proto-JSON with the *original* (snake_case) field names. `toJson(...,
// { useProtoFieldName: true })` produces exactly that shape, which matches the
// hand-written wasm DTO in ./types.ts.

import { toJson } from "@bufbuild/protobuf";
import type { PanelDescriptor } from "@meridian/proto-ts/proto/panel_pb.js";
import { PanelDescriptorSchema } from "@meridian/proto-ts/proto/panel_pb.js";

import { renderPanel } from "./renderer.js";
import type { UiviewWasm } from "./renderer.js";
import type {
  PanelDescriptor as WasmPanelDescriptor,
  RenderContext,
} from "./types.js";
import type {
  AdhocDomFactory,
  MountOptions,
  WebRenderer,
} from "./web_renderer.js";

const EMPTY_CONTEXT: RenderContext = {
  currentResourcePath: null,
  uiIdentity: null,
  selectedRow: null,
  formValues: {},
};

/** Convert a canonical PanelDescriptor to the snake-case wasm-JSON DTO. */
function toWasmDescriptor(descriptor: PanelDescriptor): WasmPanelDescriptor {
  return toJson(PanelDescriptorSchema, descriptor, {
    useProtoFieldName: true,
  }) as unknown as WasmPanelDescriptor;
}

/**
 * The reference {@link WebRenderer}. The host supplies the initialized wasm
 * bindings (it calls the uiview wasm `init()` first); theme is applied
 * out-of-band today via `applyTheme` from //theme/web, so `mount` accepts but
 * does not itself bind it.
 */
export function webComponentsRenderer(wasm: UiviewWasm): WebRenderer {
  return {
    id: "web-components",
    async mount(opts: MountOptions) {
      const context = opts.context ?? EMPTY_CONTEXT;

      // Adhoc factories are typed against the canonical descriptor; the legacy
      // renderer hands back its wasm DTO, so re-supply the canonical one.
      const adhocFactories:
        | Record<string, (root: HTMLElement, d: WasmPanelDescriptor) => void>
        | undefined = opts.adhoc
        ? Object.fromEntries(
            Object.entries(opts.adhoc).map(([id, factory]) => [
              id,
              (root: HTMLElement, _wasmDescriptor: WasmPanelDescriptor) =>
                (factory as AdhocDomFactory)(root, currentDescriptor),
            ]),
          )
        : undefined;

      let currentDescriptor: PanelDescriptor = opts.descriptor;
      const render = (descriptor: PanelDescriptor) => {
        currentDescriptor = descriptor;
        return renderPanel({
          wasm,
          root: opts.container,
          descriptor: toWasmDescriptor(descriptor),
          invoker: opts.invoker,
          context,
          adhocFactories,
        });
      };

      await render(opts.descriptor);
      return {
        update: (descriptor: PanelDescriptor) => render(descriptor),
        unmount: () => {
          opts.container.innerHTML = "";
        },
      };
    },
  };
}
