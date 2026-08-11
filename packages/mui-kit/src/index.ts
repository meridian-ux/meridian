// @savvifi/meridian-mui-kit — the MUI ComponentKit for the meridian React
// renderer. Paints meridian.ui.v1 PanelDescriptors / ViewDescriptors with MUI
// (its own table + form components, with CLIENT/OFFSET/CURSOR pagination), over
// the @savvifi/meridian-web-react seam. No a host's internal MUI component library dependency.

export { muiKit } from "./mui_kit.js";
export {
  MeridianMuiProvider,
  type MeridianMuiProviderProps,
} from "./provider.js";
export {
  themeProtoToThemeConfig,
  themeProtoToMuiTheme,
  themeProtoToCssVars,
  themeProtoToFontFaceCss,
  themeFontSources,
  missingThemeFonts,
  primaryFamily,
  createMuiThemeFromConfig,
  type ThemeConfig,
  type FontSourceView,
} from "./theme.js";
export { MeridianTable, type MeridianColumn, type MeridianTableProps } from "./components/table.js";
export { MeridianForm, type MeridianFormField, type MeridianFormProps } from "./components/form.js";
export { MeridianDetailHeader } from "./components/detail_header.js";
export { MeridianRecordCard } from "./components/record_card.js";
// Shared read-view value formatting — the one place that decides how a value
// READS, so a card field and a table cell can agree.
export {
  EMPTY_DISPLAY,
  displayValueList,
  formatByDisplay,
  formatDisplayValue,
  formatRelativeTime,
  formatTimestamp,
  type DisplayedValue,
} from "./display_format.js";
// The instant relative labels measure against — undefined until mounted, which is
// what keeps an SSR render and its hydration byte-identical.
export { useDisplayNow } from "./use_display_now.js";
export {
  ChoiceView,
  SnippetView,
  CopyValueView,
  ActionView,
  CatalogView,
  ConnectFlowView,
  GrammarView,
  StatView,
  StepsView,
  MediaView,
} from "./components/content.js";
