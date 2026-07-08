// MeridianProvider — the React context that carries the cross-cutting inputs a
// PanelRenderer needs: the active Theme (skin), the RpcInvoker (transport), the
// chosen ComponentKit, and the adhoc-handler registry. It composes with a host's
// other providers; it does not replace them.

import { createContext, useContext } from "react";
import type { ComponentType, ReactNode } from "react";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import type { ComponentKit } from "./component_kit.js";

/** The React renderer's AdhocPanel factory: a component rendered for a handler_id. */
export type ReactAdhocFactory = ComponentType<{ descriptor: PanelDescriptor }>;

/**
 * Host handler for actions that carry no RpcCall. aion's `actions`/`action-set-key`
 * (view_details / edit / create …) project as host-resolved *keys* — the renderer
 * draws the affordance, but the meaning (usually a route) is the host's. When such
 * an action fires, the renderer calls this with the action's id + the view's
 * subject (entity type) + the bound row id (ROW actions). Actions that DO carry an
 * RpcCall still go through the invoker; this covers only the no-call remainder.
 */
export type MeridianActionHandler = (
  actionId: string,
  entityType?: string,
  entityId?: string | number,
) => void;

/**
 * Host glyph resolver for the content shapes' `icon` keys (ChoiceOption.icon,
 * Affordance.icon, ConnectTarget.icon, CatalogItem.icon). The descriptor names a
 * brand-neutral key ("github", "download", …); the host maps it to a React glyph
 * (an SVG, an icon-font `<i>`, an `<img>`, …). This is the icon peer of `adhoc` /
 * `onAction`: renderer draws, host wires. Absent ⇒ components draw no glyph but
 * still emit `data-icon={key}` so the key is never dropped.
 */
export type MeridianIconResolver = (key: string) => ReactNode;

/**
 * Host transcoder for a GrammarPanel (markdown / mermaid / plantuml / graphviz /
 * vega). The surface's capability set: return a React node for languages this
 * host can display, or null for the rest → the renderer degrades down the ladder
 * (native markdown → alt → source text). The kit imports no grammar library.
 */
export type MeridianGrammarResolver = (opts: {
  language: string;
  source: string;
  data?: unknown;
}) => ReactNode;

export interface MeridianContextValue {
  theme?: Theme;
  invoker: RpcInvoker;
  kit: ComponentKit;
  adhoc: Record<string, ReactAdhocFactory>;
  /** Optional host handler for no-call actions (nav/custom). Absent ⇒ no-op. */
  onAction?: MeridianActionHandler;
  /** Optional host glyph resolver for `icon` keys. Absent ⇒ no glyph drawn. */
  renderIcon?: MeridianIconResolver;
  /** Optional host transcoder for GrammarPanel. Absent/null ⇒ degradation ladder. */
  renderGrammar?: MeridianGrammarResolver;
}

const MeridianContext = createContext<MeridianContextValue | null>(null);

export function useMeridian(): MeridianContextValue {
  const value = useContext(MeridianContext);
  if (!value) {
    throw new Error("useMeridian must be used within a <MeridianProvider>");
  }
  return value;
}

export const useMeridianTheme = (): Theme | undefined => useMeridian().theme;
export const useRpcInvoker = (): RpcInvoker => useMeridian().invoker;
export const useComponentKit = (): ComponentKit => useMeridian().kit;
export const useAdhocHandler = (
  handlerId: string,
): ReactAdhocFactory | undefined => useMeridian().adhoc[handlerId];
export const useActionHandler = (): MeridianActionHandler | undefined =>
  useMeridian().onAction;

/**
 * Resolve an `icon` key to a host glyph (or null). Components render the result
 * before a label; they should ALSO set `data-icon={key}` so the key survives
 * even when no resolver is wired. Safe to call with an empty/absent key.
 */
export function useIcon(key: string | undefined): ReactNode {
  const resolver = useMeridian().renderIcon;
  if (!key || !resolver) return null;
  return resolver(key) ?? null;
}

/** The host's GrammarPanel transcoder (or undefined). GrammarContent tries it,
 *  then degrades. */
export const useGrammarResolver = (): MeridianGrammarResolver | undefined =>
  useMeridian().renderGrammar;

export interface MeridianProviderProps extends MeridianContextValue {
  children: ReactNode;
}

export function MeridianProvider({
  children,
  ...value
}: MeridianProviderProps): ReactNode {
  return (
    <MeridianContext.Provider value={value}>
      {children}
    </MeridianContext.Provider>
  );
}
