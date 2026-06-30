// @meridian/web-react — the React renderer tier of the meridian renderer family.
//
// A kit-agnostic React adapter over the framework-neutral WebRenderer seam
// (@meridian/core/uiview): it renders meridian.ui.v1 PanelDescriptors through a
// swappable ComponentKit. `reactWebRenderer(kit)` yields a WebRenderer a host
// can mount, a peer of the web-components / TUI / native renderers.

export type {
  ComponentKit,
  ShapeProps,
  TablePanelProps,
  PromptPanelProps,
  LroPanelProps,
  GalleryPanelProps,
  LlmPromptPanelProps,
} from "./component_kit.js";
export {
  MeridianProvider,
  useMeridian,
  useMeridianTheme,
  useRpcInvoker,
  useComponentKit,
  useAdhocHandler,
  type MeridianContextValue,
  type MeridianProviderProps,
  type ReactAdhocFactory,
} from "./provider.js";
export { PanelRenderer } from "./panel_renderer.js";
export { reactWebRenderer } from "./react_web_renderer.js";
export { htmlKit } from "./html_kit.js";
