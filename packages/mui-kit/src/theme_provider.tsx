// The single MUI theme realization used by both host and WebRenderer entrypoints.
// This boundary owns style only: transport/admission stay in MeridianProvider.
import { useEffect, useMemo, type ReactNode } from "react";
import { CssBaseline, GlobalStyles, ScopedCssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { missingThemeFonts, themeProtoToCssVars, themeProtoToFontFaceCss, themeProtoToMuiTheme } from "./theme.js";

declare const process: { env?: { NODE_ENV?: string } } | undefined;
function isProduction(): boolean {
  return typeof process !== "undefined" && process?.env?.NODE_ENV === "production";
}

export function MuiThemeBoundary({ theme, mode = "light", scoped = false, children }: {
  theme?: Theme;
  mode?: "light" | "dark";
  scoped?: boolean;
  children: ReactNode;
}): ReactNode {
  const muiTheme = useMemo(() => themeProtoToMuiTheme(theme, mode), [theme, mode]);
  const cssVars = useMemo(() => themeProtoToCssVars(theme, mode), [theme, mode]);
  const fontFaceCss = useMemo(() => themeProtoToFontFaceCss(theme), [theme]);

  useEffect(() => {
    if (isProduction()) return;
    const report = (): void => {
      const missing = missingThemeFonts(theme);
      if (missing.length === 0) return;
      console.warn(
        `[meridian-mui-kit] The active skin asks for ${missing.map(f => `"${f}"`).join(", ")}, ` +
        `which the browser cannot resolve — text is rendering in a fallback face and the brand is not being applied. ` +
        `Either declare the source on the skin (meridian.theme.v1.Typography.fonts) or load the face in the host page.`,
      );
    };
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts?.ready) void fonts.ready.then(report).catch(() => report());
    else report();
  }, [theme]);

  return <ThemeProvider theme={muiTheme}>
    {scoped ? null : <CssBaseline />}
    {fontFaceCss ? <GlobalStyles styles={fontFaceCss} /> : null}
    {scoped ? <ScopedCssBaseline style={cssVars}>{children}</ScopedCssBaseline>
      : <div style={cssVars}>{children}</div>}
  </ThemeProvider>;
}

/** An independently mounted panel owns only its subtree, not the host's body. */
export function MuiMountThemeBoundary({ theme, children }: { theme?: Theme; children: ReactNode }): ReactNode {
  return <MuiThemeBoundary theme={theme} scoped>{children}</MuiThemeBoundary>;
}
