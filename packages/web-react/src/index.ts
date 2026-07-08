// @savvifi/meridian-web-react — the React renderer tier of the meridian renderer family.
//
// A kit-agnostic React adapter over the framework-neutral WebRenderer seam
// (@savvifi/meridian-schemas/uiview): it renders meridian.ui.v1 PanelDescriptors through a
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
  FormPanelProps,
  ChoicePanelProps,
  SnippetPanelProps,
  ActionPanelProps,
  ConnectFlowPanelProps,
  CopyValuePanelProps,
  CatalogPanelProps,
  GrammarPanelProps,
  StatPanelProps,
  ActionBarProps,
} from "./component_kit.js";
export {
  MeridianProvider,
  useMeridian,
  useMeridianTheme,
  useRpcInvoker,
  useComponentKit,
  useAdhocHandler,
  useActionHandler,
  useIcon,
  useGrammarResolver,
  type MeridianContextValue,
  type MeridianProviderProps,
  type ReactAdhocFactory,
  type MeridianActionHandler,
  type MeridianIconResolver,
  type MeridianGrammarResolver,
} from "./provider.js";
export { PanelRenderer } from "./panel_renderer.js";
export {
  ViewRenderer,
  MeridianRowActionsContext,
  MeridianViewContext,
} from "./view_renderer.js";
export {
  usePagedRows,
  resolvePagination,
  buildPageRequest,
  readPage,
  PaginationMode,
  MeridianInitialDataContext,
  type PagedTable,
  type MeridianPageSeed,
  type MeridianInitialData,
} from "./pagination.js";
export { reactWebRenderer } from "./react_web_renderer.js";
export { htmlKit } from "./html_kit.js";
export { shadcnKit } from "./shadcn_kit.js";
// Shared grammar helpers (reused by other kits, e.g. mui): one markdown impl +
// the GrammarLanguage → token map for the degradation ladder.
export { renderMarkdown, grammarLanguageName } from "./content_shapes.js";
