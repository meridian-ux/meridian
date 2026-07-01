// @savvifi/meridian-mui-kit — the MUI ComponentKit for the meridian React
// renderer. Paints meridian.ui.v1 PanelDescriptors / ViewDescriptors with MUI
// (its own table + form components, with CLIENT/OFFSET/CURSOR pagination), over
// the @savvifi/meridian-web-react seam. No @aion/ui dependency.

export { muiKit, aionMuiKit } from "./mui_kit.js";
export {
  MeridianMuiProvider,
  type MeridianMuiProviderProps,
} from "./provider.js";
export {
  themeProtoToThemeConfig,
  themeProtoToMuiTheme,
  createMuiThemeFromConfig,
  type ThemeConfig,
} from "./theme.js";
export { MeridianTable, type MeridianColumn, type MeridianTableProps } from "./components/table.js";
export { MeridianForm, type MeridianFormField, type MeridianFormProps } from "./components/form.js";
