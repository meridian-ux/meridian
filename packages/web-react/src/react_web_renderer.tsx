// reactWebRenderer — turns a ComponentKit into a meridian `WebRenderer` (the
// framework-neutral seam from @savvifi/meridian-schemas/uiview). This is the React branch
// of the web swap point: `reactWebRenderer(muiKit)` and
// `reactWebRenderer(shadcnKit)` are both WebRenderers a host can mount, peers of
// the web-components renderer — all consuming the same PanelDescriptor + Theme.

import { createRoot } from "react-dom/client";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import type {
  MountOptions,
  PanelHandle,
  WebRenderer,
} from "@savvifi/meridian-schemas/uiview";

import type { ComponentKit } from "./component_kit.js";
import { PanelRenderer } from "./panel_renderer.js";
import { MeridianProvider, type ReactAdhocFactory } from "./provider.js";

export function reactWebRenderer(
  kit: ComponentKit,
): WebRenderer<Theme, ReactAdhocFactory> {
  return {
    id: `react:${kit.id}`,
    mount(opts: MountOptions<Theme, ReactAdhocFactory>): PanelHandle {
      const root = createRoot(opts.container);
      const draw = (descriptor: PanelDescriptor) =>
        root.render(
          <MeridianProvider
            theme={opts.theme}
            invoker={opts.invoker}
            kit={kit}
            adhoc={opts.adhoc ?? {}}
          >
            <PanelRenderer descriptor={descriptor} />
          </MeridianProvider>,
        );
      draw(opts.descriptor);
      return {
        update: (descriptor: PanelDescriptor) => draw(descriptor),
        unmount: () => root.unmount(),
      };
    },
  };
}
