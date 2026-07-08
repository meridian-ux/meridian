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
import type {
  MeridianActionHandler,
  ReactAdhocFactory,
} from "@savvifi/meridian-web-react";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { muiKit } from "./mui_kit.js";
import { themeProtoToCssVars, themeProtoToMuiTheme } from "./theme.js";

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
   * host-resolved keys aion projects without an RpcCall). Absent ⇒ those
   * buttons render but no-op; RpcCall actions always route through the invoker.
   */
  onAction?: MeridianActionHandler;
  children?: ReactNode;
}

export function MeridianMuiProvider({
  invoker,
  theme,
  mode = "light",
  adhoc = {},
  onAction,
  children,
}: MeridianMuiProviderProps): ReactNode {
  const muiTheme = useMemo(() => themeProtoToMuiTheme(theme, mode), [theme, mode]);
  const cssVars = useMemo(() => themeProtoToCssVars(theme, mode), [theme, mode]);
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {/* Expose the skin as --mer-* vars so ViewRenderer's kit-neutral layout
          chrome (tab strip, etc.) picks up the active theme. */}
      <div style={cssVars}>
        <MeridianProvider
          theme={theme}
          invoker={invoker}
          kit={muiKit}
          adhoc={adhoc}
          onAction={onAction}
        >
          {children}
        </MeridianProvider>
      </div>
    </ThemeProvider>
  );
}
