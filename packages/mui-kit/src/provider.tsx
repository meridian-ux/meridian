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

import type { ReactNode } from "react";

import { MeridianProvider } from "@savvifi/meridian-web-react";
import type {
  MeridianActionHandler,
  MeridianGrammarResolver,
  MeridianHrefResolver,
  MeridianIconResolver,
  MeridianContextValue,
  ReactAdhocFactory,
} from "@savvifi/meridian-web-react";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import type { AdmissionPolicy, RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianAssetContext, type MeridianAssetResolver } from "./asset_context.js";
import { muiKit } from "./mui_kit.js";
import { MuiThemeBoundary } from "./theme_provider.js";

export interface MeridianMuiProviderProps {
  onPromptResponse?: MeridianContextValue["onPromptResponse"];
  invoker: RpcInvoker;
  streamSnapshots?: MeridianContextValue["streamSnapshots"];
  /** Host policy for descriptor-originated RPCs. Reads default open; mutations default closed. */
  admission?: AdmissionPolicy;
  invocation?: MeridianContextValue["invocation"];
  /** The meridian skin. Optional — falls back to neutral MUI defaults. */
  theme?: Theme;
  /** light | dark selection into the Theme's palettes. */
  mode?: "light" | "dark";
  /** Host adhoc-panel handlers, keyed by AdhocPanel.handler_id. */
  adhoc?: Record<string, ReactAdhocFactory>;
  /**
   * Compatibility handler for implicit row-click navigation not yet migrated.
   * Authored no-call actions use invocation.resolveSemantic instead; do not
   * execute an old callback during pure resolution or after canonical denial.
   */
  onAction?: MeridianActionHandler;
  /** Host glyph resolver for the content shapes' `icon` keys (renderer draws,
   *  host wires). Absent ⇒ no glyph drawn (the key still lands as `data-icon`). */
  renderIcon?: MeridianIconResolver;
  /** Host transcoder for GrammarPanel (markdown / mermaid / vega …). Absent/null
   *  ⇒ the degradation ladder (native markdown → alt → source). */
  renderGrammar?: MeridianGrammarResolver;
  /** Host resolver for table ColumnLink and declared ValueDisplay record
   *  destinations. Absent ⇒ those link cells render as plain text. */
  resolveHref?: MeridianHrefResolver;
  /** Host resolver for asset (image) URLs a panel renders — e.g. prefix a mount
   *  base or swap a CDN host. Used by the Gallery's images. Absent ⇒ src verbatim. */
  resolveAssetSrc?: MeridianAssetResolver;
  children?: ReactNode;
}

export function MeridianMuiProvider({
  invoker,
  streamSnapshots,
  admission,
  invocation,
  theme,
  mode = "light",
  adhoc = {},
  onAction,
  onPromptResponse,
  renderIcon,
  renderGrammar,
  resolveHref,
  resolveAssetSrc,
  children,
}: MeridianMuiProviderProps): ReactNode {
  return (
    <MuiThemeBoundary theme={theme} mode={mode}>
        <MeridianProvider
          theme={theme}
          invoker={invoker}
          streamSnapshots={streamSnapshots}
          admission={admission}
          invocation={invocation}
          kit={muiKit}
          adhoc={adhoc}
          onAction={onAction}
          onPromptResponse={onPromptResponse}
          renderIcon={renderIcon}
          renderGrammar={renderGrammar}
          resolveHref={resolveHref}
        >
          <MeridianAssetContext.Provider value={resolveAssetSrc}>{children}</MeridianAssetContext.Provider>
        </MeridianProvider>
    </MuiThemeBoundary>
  );
}
