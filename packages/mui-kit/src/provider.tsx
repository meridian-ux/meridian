// MeridianMuiProvider — the one-line host integration surface for the aion MUI
// kit. It sets up a single MUI ThemeProvider (bound to the meridian Theme) and
// a CssBaseline over the whole subtree, then a MeridianProvider wired to
// aionMuiKit. Because the theme provider sits above everything, view-level and
// slot-level Actions (rendered by ViewRenderer outside any panel Chrome) are
// themed too.
//
// Usage:
//   <MeridianMuiProvider invoker={rpc} theme={skin} adhoc={handlers}>
//     <ViewRenderer view={viewDescriptor} />
//   </MeridianMuiProvider>

import { useMemo } from "react";
import type { ReactNode } from "react";

import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";

import { MeridianProvider } from "@savvifi/meridian-web-react";
import type { ReactAdhocFactory } from "@savvifi/meridian-web-react";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { aionMuiKit } from "./aion_mui_kit.js";
import { themeProtoToMuiTheme } from "./theme.js";

export interface MeridianMuiProviderProps {
  invoker: RpcInvoker;
  /** The meridian skin. Optional — falls back to neutral MUI defaults. */
  theme?: Theme;
  /** light | dark selection into the Theme's palettes. */
  mode?: "light" | "dark";
  /** Host adhoc-panel handlers, keyed by AdhocPanel.handler_id. */
  adhoc?: Record<string, ReactAdhocFactory>;
  children: ReactNode;
}

export function MeridianMuiProvider({
  invoker,
  theme,
  mode = "light",
  adhoc = {},
  children,
}: MeridianMuiProviderProps): ReactNode {
  const muiTheme = useMemo(() => themeProtoToMuiTheme(theme, mode), [theme, mode]);
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <MeridianProvider theme={theme} invoker={invoker} kit={aionMuiKit} adhoc={adhoc}>
        {children}
      </MeridianProvider>
    </ThemeProvider>
  );
}
