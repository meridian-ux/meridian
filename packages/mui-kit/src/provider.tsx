// MeridianMuiProvider — the one-line host integration surface for a graph-backed host's MUI
// kit. It sets up a single MUI ThemeProvider (bound to the meridian Theme) and
// a CssBaseline over the whole subtree, then a MeridianProvider wired to
// muiKit. Because the theme provider sits above everything, view-level and
// slot-level Actions (rendered by ViewRenderer outside any panel Chrome) are
// themed too.
//
// Usage:
//   <MeridianMuiProvider invoker={rpc} theme={skin} adhoc={handlers}>
//     <ViewRenderer view={viewDescriptor} />
//   </MeridianMuiProvider>

import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import { CssBaseline, GlobalStyles } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";

import { MeridianProvider } from "@savvifi/meridian-web-react";
import type {
  MeridianActionHandler,
  MeridianGrammarResolver,
  MeridianHrefResolver,
  MeridianIconResolver,
  ReactAdhocFactory,
} from "@savvifi/meridian-web-react";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianAssetContext, type MeridianAssetResolver } from "./asset_context.js";
import { muiKit } from "./mui_kit.js";
import {
  missingThemeFonts,
  themeProtoToCssVars,
  themeProtoToFontFaceCss,
  themeProtoToMuiTheme,
} from "./theme.js";

// Dev-only guards read NODE_ENV without pulling @types/node into this browser
// library (tsconfig keeps `types: []`): a minimal ambient + defensive access.
// Bundlers inline `process.env.NODE_ENV`; a bare browser without the define
// simply skips the check rather than throwing a ReferenceError.
declare const process: { env?: { NODE_ENV?: string } } | undefined;
function isProduction(): boolean {
  return typeof process !== "undefined" && process?.env?.NODE_ENV === "production";
}

export interface MeridianMuiProviderProps {
  invoker: RpcInvoker;
  /** The meridian skin. Optional — falls back to neutral MUI defaults. */
  theme?: Theme;
  /** light | dark selection into the Theme's palettes. */
  mode?: "light" | "dark";
  /** Host adhoc-panel handlers, keyed by AdhocPanel.handler_id. */
  adhoc?: Record<string, ReactAdhocFactory>;
  /**
   * Host handler for no-call actions (view_details / edit / create … — the
   * host-resolved keys that host projects without an RpcCall). Absent ⇒ those
   * buttons render but no-op; RpcCall actions always route through the invoker.
   */
  onAction?: MeridianActionHandler;
  /** Host glyph resolver for the content shapes' `icon` keys (renderer draws,
   *  host wires). Absent ⇒ no glyph drawn (the key still lands as `data-icon`). */
  renderIcon?: MeridianIconResolver;
  /** Host transcoder for GrammarPanel (markdown / mermaid / vega …). Absent/null
   *  ⇒ the degradation ladder (native markdown → alt → source). */
  renderGrammar?: MeridianGrammarResolver;
  /** Host resolver for a table cell's link destination (ColumnLink). Absent ⇒
   *  link cells render as plain text. */
  resolveHref?: MeridianHrefResolver;
  /** Host resolver for asset (image) URLs a panel renders — e.g. prefix a mount
   *  base or swap a CDN host. Used by the Gallery's images. Absent ⇒ src verbatim. */
  resolveAssetSrc?: MeridianAssetResolver;
  children?: ReactNode;
}

export function MeridianMuiProvider({
  invoker,
  theme,
  mode = "light",
  adhoc = {},
  onAction,
  renderIcon,
  renderGrammar,
  resolveHref,
  resolveAssetSrc,
  children,
}: MeridianMuiProviderProps): ReactNode {
  const muiTheme = useMemo(() => themeProtoToMuiTheme(theme, mode), [theme, mode]);
  const cssVars = useMemo(() => themeProtoToCssVars(theme, mode), [theme, mode]);
  const fontFaceCss = useMemo(() => themeProtoToFontFaceCss(theme), [theme]);

  // A skin naming a face the browser cannot resolve renders in a fallback with
  // no error — the brand silently does not apply, and nobody finds out. Say so
  // once, in development, rather than letting it pass unnoticed. Never throws
  // and never runs in production.
  useEffect(() => {
    if (isProduction()) return;
    const report = (): void => {
      const missing = missingThemeFonts(theme);
      if (missing.length === 0) return;
      console.warn(
        `[meridian-mui-kit] The active skin asks for ${missing
          .map((f) => `"${f}"`)
          .join(", ")}, which the browser cannot resolve — text is rendering in a ` +
          `fallback face and the brand is not being applied. Either declare the ` +
          `source on the skin (meridian.theme.v1.Typography.fonts) or load the ` +
          `face in the host page.`,
      );
    };
    // Wait for in-flight webfonts before judging, so a face that simply hadn't
    // finished loading is not reported as missing.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.ready) void fonts.ready.then(report).catch(() => report());
    else report();
  }, [theme]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {/* The skin's own @font-face rules, so a face it names is actually
          available rather than assumed to be loaded by the host. Empty for
          skins that declare no sources. */}
      {fontFaceCss ? <GlobalStyles styles={fontFaceCss} /> : null}
      {/* Expose the skin as --mer-* vars so ViewRenderer's kit-neutral layout
          chrome (tab strip, etc.) picks up the active theme. */}
      <div style={cssVars}>
        <MeridianProvider
          theme={theme}
          invoker={invoker}
          kit={muiKit}
          adhoc={adhoc}
          onAction={onAction}
          renderIcon={renderIcon}
          renderGrammar={renderGrammar}
          resolveHref={resolveHref}
        >
          <MeridianAssetContext.Provider value={resolveAssetSrc}>{children}</MeridianAssetContext.Provider>
        </MeridianProvider>
      </div>
    </ThemeProvider>
  );
}
