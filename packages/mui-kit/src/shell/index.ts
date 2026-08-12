// @savvifi/meridian-mui-kit/shell — the MUI renderer for meridian's application frame.
//
// The first implementation of three primitives that were specified and unrendered:
// `AppShell` (shell.proto), `NavTree` (nav_tree.proto, landed 0.6.0) and `Launchpad`
// (command_palette.proto). A host mounts `<AppShellView>` with a descriptor and its seams.
//
// A SUBPATH rather than a package, so it inherits mui-kit's peer set, its single-copy
// discipline, its browser harness and its publish workflow instead of duplicating all four.
// It is not re-exported from the root: an app that renders panels and no frame should not
// pay for a drawer.
//
//   import { AppShellView } from "@savvifi/meridian-mui-kit/shell";

export { AppShellView } from "./views/AppShellView.js";
export { SidebarView, resolveSidebarSx } from "./views/SidebarView.js";
export { LaunchpadView } from "./views/LaunchpadView.js";
export { AppHeaderView } from "./views/AppHeaderView.js";

export {
  ShellProvider,
  useShell,
  usePageActions,
  useIsApplePlatform,
  type ShellContextValue,
  type TogglePanel,
} from "./context.js";

export {
  brandOf,
  resolveScope,
  type AppShellProps,
  type AppShellSeams,
  type NavNodeLike,
  type ResolvedScope,
  type ShellLinkComponent,
  type ShellRouting,
} from "./config.js";

// The frame's own capability model and bindings — exported because a host that renders its
// own header still wants to agree with the shell about what ⌘K does.
export {
  capabilitiesOf,
  displayKeys,
  isEditableTarget,
  isHotkeyEnabled,
  matchHotkey,
  SHELL_HOTKEYS,
  type ShellCapabilities,
  type ShellHotkey,
  type ShellHotkeyId,
} from "./chrome.js";

// Reading a NavTree. Pure, and useful to a host building one.
export {
  activeNodeId,
  ancestorsOf,
  hrefForNode,
  initiallyOpenGroups,
  isActive,
  isGroup,
  walk,
} from "./nav.js";

// Matching a Launchpad. Same reasoning — a host serving commands from `GetLaunchpad` may
// want to rank them the way the overlay will.
export {
  defaultCommands,
  flatten,
  matchCommands,
  moveIndex,
  type MatchedGroup,
} from "./launchpad.js";
