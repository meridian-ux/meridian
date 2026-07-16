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
  DetailHeaderPanelProps,
  RecordCardPanelProps,
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
  useHrefResolver,
  type MeridianContextValue,
  type MeridianProviderProps,
  type ReactAdhocFactory,
  type MeridianActionHandler,
  type MeridianIconResolver,
  type MeridianGrammarResolver,
  type MeridianHrefResolver,
} from "./provider.js";
export { PanelRenderer } from "./panel_renderer.js";
export {
  ViewRenderer,
  MeridianRowActionsContext,
  MeridianViewContext,
} from "./view_renderer.js";
export {
  usePagedRows,
  useRecord,
  resolvePath,
  resolvePagination,
  buildPageRequest,
  readPage,
  buildBindingRequest,
  selectionDeps,
  hasSelectionBindings,
  PaginationMode,
  MeridianInitialDataContext,
  MeridianSelectionContext,
  useMeridianSelection,
  type PagedTable,
  type RecordState,
  type MeridianPageSeed,
  type MeridianInitialData,
  type MeridianSelection,
} from "./pagination.js";
export { reactWebRenderer } from "./react_web_renderer.js";
export { htmlKit } from "./html_kit.js";
export { shadcnKit } from "./shadcn_kit.js";
// Shared grammar helpers (reused by other kits, e.g. mui): one markdown impl +
// the GrammarLanguage → token map for the degradation ladder.
export { renderMarkdown, grammarLanguageName } from "./content_shapes.js";
