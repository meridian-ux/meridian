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

export interface MeridianContextValue {
  theme?: Theme;
  invoker: RpcInvoker;
  kit: ComponentKit;
  adhoc: Record<string, ReactAdhocFactory>;
  /** Optional host handler for no-call actions (nav/custom). Absent ⇒ no-op. */
  onAction?: MeridianActionHandler;
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
