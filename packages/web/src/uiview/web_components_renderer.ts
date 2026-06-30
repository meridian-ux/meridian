// The reference WebRenderer: meridian's built-in web-components renderer,
// adapted to the seam. It is React-free — proof the seam is not anchored to any
// web framework.
//
// It speaks the canonical protobuf-es PanelDescriptor end to end: renderPanel
// (./renderer.ts) reads typed fields off it and serializes whole messages to
// protobuf binary for the wasm core. No JSON / snake_case DTO bridge.

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type {
  MountOptions,
  RenderContext,
  WebRenderer,
} from "@savvifi/meridian-schemas/uiview";

import { renderPanel } from "./renderer.js";
import type { UiviewWasm } from "./renderer.js";

const EMPTY_CONTEXT: RenderContext = {
  currentResourcePath: null,
  uiIdentity: null,
  selectedRow: null,
  formValues: {},
};

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

      // Adhoc factories from the seam registry are (container, descriptor) over
      // the canonical descriptor — exactly what renderPanel hands them.
      const adhocFactories = opts.adhoc as
        | Record<string, (root: HTMLElement, d: PanelDescriptor) => void>
        | undefined;

      const render = (descriptor: PanelDescriptor) =>
        renderPanel({
          wasm,
          root: opts.container,
          descriptor,
          invoker: opts.invoker,
          context,
          adhocFactories,
        });

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
