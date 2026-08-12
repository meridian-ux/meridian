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

import { disposePanel, renderPanel } from "./renderer.js";
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

      const renderIcon = opts.renderIcon as
        | ((key: string) => HTMLElement | undefined)
        | undefined;

      const renderGrammar = opts.renderGrammar as
        | ((o: { language: string; source: string; data?: unknown }) => HTMLElement | undefined)
        | undefined;

      const resolveHref = opts.resolveHref as
        | ((o: { targetKind: string; id: string; row?: object }) => string | null | undefined)
        | undefined;

      const render = (descriptor: PanelDescriptor) =>
        renderPanel({
          wasm,
          root: opts.container,
          descriptor,
          invoker: opts.invoker,
          streamInvoker: opts.streamInvoker,
          context,
          adhocFactories,
          renderIcon,
          resolveHref,
          renderGrammar,
        });

      await render(opts.descriptor);
      return {
        update: (descriptor: PanelDescriptor) => render(descriptor),
        unmount: () => {
          // Release live resources (a terminal's socket, a stream's
          // subscription) BEFORE dropping the DOM — clearing innerHTML alone
          // left them running.
          disposePanel(opts.container);
          opts.container.innerHTML = "";
        },
      };
    },
  };
}
