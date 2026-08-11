"use client";
// Chrome state: the sidebar, the launchpad, the shortcuts sheet, the chat dock, and the slot
// a page uses to put its own actions in the page-header row.
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
  /** A page's own toolbar actions, rendered in the page-header row beside `seams.pageChrome`. */
  pageActions: React.ReactNode | null;
  setPageActions: (actions: React.ReactNode | null) => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

/**
 * The page-actions SETTER, on its own context.
 *
 * ⛔ THIS SPLIT IS LOAD-BEARING, and it is not a micro-optimization.
 *
 * `pageActions` lives in the shell context value, so publishing it re-renders every context
 * consumer. If `usePageActions` read the setter through `useShell()`, the publishing PAGE
 * would be one of those consumers: it re-renders, its `<Button/>` argument is a brand-new
 * element, the effect's `[actions]` dependency has therefore changed, the effect publishes
 * again — and that is a render loop that terminates only in React's "Maximum update depth
 * exceeded". The obvious workaround is to make every caller wrap its actions in `useMemo`,
 * which is a rule no signature announces and every new page forgets once.
 *
 * A setter from `useState` is referentially stable for the lifetime of the component, so this
 * context's value never changes and subscribing to it never causes a render. The publisher
 * is no longer a subscriber, and the cycle cannot form.
 */
const SetPageActionsContext = React.createContext<((actions: React.ReactNode | null) => void) | null>(
  null,
);

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

  return (
    <SetPageActionsContext.Provider value={setPageActions}>
      <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
    </SetPageActionsContext.Provider>
  );
}

export function useShell(): ShellContextValue {
  const context = React.useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <AppShellView>");
  return context;
}

/**
 * Publish this page's toolbar actions into the page-header row, and take them down on unmount.
 *
 * Callers need not memoize the node — see `SetPageActionsContext` for why that is a property
 * of the design rather than an accident.
 *
 * ⛔ The teardown is the point. Without it, navigating from Sponsors to Plan Years leaves a
 * "Create sponsor" button sitting above the plan-year list, wired to the wrong flow — a
 * button that is not merely stale but actively wrong about what it will do.
 */
export function usePageActions(actions: React.ReactNode): void {
  // ⛔ NOT `useShell()` — see the note on `SetPageActionsContext`. Reading the setter from the
  // shell value would subscribe the publisher to its own publication.
  const setPageActions = React.useContext(SetPageActionsContext);
  if (!setPageActions) throw new Error("usePageActions must be used inside <AppShellView>");
  React.useEffect(() => {
    setPageActions(actions);
    return () => setPageActions(null);
  }, [actions, setPageActions]);
}

/**
 * Whether the viewer is on an Apple platform, for `⌘` vs `Ctrl`.
 *
 * ⛔ Returns `false` on the server AND on the first client render, then corrects itself in an
 * effect. Reading `navigator.platform` during render is a hydration mismatch, not a nicety:
 * the server has no `navigator` and renders "Ctrl", the browser's first render says "⌘", and
 * React discards the hydrated tree over a two-character chip in the header. `displayKeys`
 * takes the platform as an argument precisely so the decision can be deferred to here.
 */
export function useIsApplePlatform(): boolean {
  const [apple, setApple] = React.useState(false);
  React.useEffect(() => {
    if (typeof navigator === "undefined") return;
    setApple(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || ""));
  }, []);
  return apple;
}
