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

export interface MeridianContextValue {
  theme?: Theme;
  invoker: RpcInvoker;
  kit: ComponentKit;
  adhoc: Record<string, ReactAdhocFactory>;
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
