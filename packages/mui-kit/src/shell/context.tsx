"use client";
// Chrome state: the sidebar, the launchpad, the shortcuts sheet, the chat dock, and the slot
// a page uses to put its own actions in the breadcrumb bar.
//
// Collapses what aion spreads across `hooks/useAppContext.ts`,
// `components/providers/AppContextProvider.tsx` and the `useHotkeys` wiring in `AppProvider`
// — separate there because the panels are built from `@aion/common-utils` state helpers and
// the bindings go through a `react-hotkeys-hook` registry. Both are a few lines each once
// the packages are gone, and a registry for three bindings is a registry for three bindings.

import * as React from "react";

import type { AppShell } from "@savvifi/meridian-proto-ts/proto/shell_pb.js";

import { capabilitiesOf, matchHotkey, type ShellCapabilities } from "./chrome.js";
import type { AppShellSeams } from "./config.js";

export interface TogglePanel {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export interface ShellContextValue {
  shell: AppShell;
  seams: AppShellSeams;
  capabilities: ShellCapabilities;
  sidebar: TogglePanel;
  launchpad: TogglePanel;
  hotkeyHelp: TogglePanel;
  chat: TogglePanel;
  /** A page's own toolbar actions, rendered in the breadcrumb bar. */
  pageActions: React.ReactNode | null;
  setPageActions: (actions: React.ReactNode | null) => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

function usePanel(initialOpen: boolean): TogglePanel {
  const [isOpen, setIsOpen] = React.useState(initialOpen);
  return React.useMemo(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((value) => !value),
    }),
    [isOpen],
  );
}

export function ShellProvider({
  shell,
  seams,
  children,
}: {
  shell: AppShell;
  seams: AppShellSeams;
  children: React.ReactNode;
}) {
  const capabilities = React.useMemo(() => capabilitiesOf(shell), [shell]);

  // ⛔ The sidebar starts CLOSED and the layout opens it in an effect once it knows the
  // viewport. Starting it open is a hydration mismatch on mobile: the server cannot evaluate
  // a media query, so it must render the state that is safe on both sides.
  const sidebar = usePanel(false);
  const launchpad = usePanel(false);
  const hotkeyHelp = usePanel(false);
  const chat = usePanel(shell.chat?.defaultOpen === true);

  const [pageActions, setPageActions] = React.useState<React.ReactNode | null>(null);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hotkey = matchHotkey(event, capabilities);
      if (!hotkey) return;
      event.preventDefault();
      if (hotkey.id === "launchpad") launchpad.open();
      if (hotkey.id === "sidebar-toggle") sidebar.toggle();
      if (hotkey.id === "hotkey-help") hotkeyHelp.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capabilities, launchpad, sidebar, hotkeyHelp]);

  const value = React.useMemo<ShellContextValue>(
    () => ({
      shell,
      seams,
      capabilities,
      sidebar,
      launchpad,
      hotkeyHelp,
      chat,
      pageActions,
      setPageActions,
    }),
    [shell, seams, capabilities, sidebar, launchpad, hotkeyHelp, chat, pageActions],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const context = React.useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <AppShellView>");
  return context;
}

/**
 * Publish this page's toolbar actions into the breadcrumb bar, and take them down on unmount.
 *
 * ⛔ The teardown is the point. Without it, navigating from Sponsors to Plan Years leaves a
 * "Create sponsor" button sitting above the plan-year list, wired to the wrong flow — a
 * button that is not merely stale but actively wrong about what it will do.
 */
export function usePageActions(actions: React.ReactNode): void {
  const { setPageActions } = useShell();
  React.useEffect(() => {
    setPageActions(actions);
    return () => setPageActions(null);
  }, [actions, setPageActions]);
}
