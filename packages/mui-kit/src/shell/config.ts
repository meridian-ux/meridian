// The app shell's two halves: the DESCRIPTOR and the SEAMS.
//
// ⛔ THE SPLIT IS THE DESIGN, and it is the one meridian already makes everywhere else.
// PanelDescriptor is data and ComponentKit is code; ViewDescriptor is data and RpcInvoker is
// code. So: `AppShell` (shell.proto) says WHAT the frame contains — title, rail, launchpad,
// header and user-menu links, scope options, dock geometry — and `AppShellSeams` supplies
// the handful of things that cannot be data:
//
//   • the router      — a `Link` component and the current path
//   • icon components — via meridian's existing `renderIcon` seam, not a slot here
//   • the brand mark  — an SVG/wordmark node, not a URL fetched above the fold
//   • the chat panel  — a live transport, not data
//   • callbacks       — what happens when the scope selector changes
//
// A descriptor that tried to carry those would be one no host could satisfy; a config that
// carried the rest as plain TS would be a second nav shape competing with the proto meridian
// already defines. Neither half is optional and neither absorbs the other.
//
// ⛔ THE ROUTING SEAM IS WHY THIS PACKAGE CAN EXIST AT ALL. `one production host's app-shell package` is 11,486
// lines that exactly one application can use, and the reason is two symbols: it imports
// `Link` and `usePathname` from `a host's internal MUI component library`, which drags in sixteen workspace packages. A
// shell that imports a router serves one app. So the router arrives here, and the shell
// imports none — that host passes its `NavigationProvider` bindings (next/link + next/navigation),
// hatch passes its own router, and neither is visible from inside.

import type { AppShell, ScopeSelector } from "@savvifi/meridian-proto-ts/proto/shell_pb.js";
import type * as React from "react";

/** A component that renders an anchor: `next/link`, a router's Link, or `"a"`. */
export type ShellLinkComponent = React.ComponentType<{
  href: string;
  children?: React.ReactNode;
  // MUI composes through `component={Link}`, so whatever MUI spreads must pass through.
  [key: string]: unknown;
}>;

/**
 * The two things the shell needs from a router, and nothing more.
 *
 * Deliberately not a full router interface: the shell renders links and highlights the
 * active item. It never pushes, replaces, or reads params. Asking for less is what lets a
 * host adapt its existing router in a few lines instead of writing a shim.
 */
export interface ShellRouting {
  Link: ShellLinkComponent;
  usePathname: () => string;
  /**
   * Navigate imperatively — what the launchpad runs when a command is chosen.
   *
   * ⛔ Optional only for compatibility, and a host that has a router should always pass it.
   * Without it the launchpad falls back to `window.location.assign`, which is a FULL DOCUMENT
   * LOAD: the app re-boots, client state is lost, and ⌘K — the fastest thing in the app —
   * becomes the slowest. A shell handed a `Link` already knows the host has a router; the
   * fallback exists for the host that genuinely has none, not as the normal path.
   */
  navigate?: (route: string) => void;
}

/** The subset of `NavNode` a resolver is handed. Structural, so tests need no proto. */
export interface NavNodeLike {
  readonly id: string;
  readonly label: string;
  readonly target?: { readonly case?: string; readonly value?: unknown };
}

/** Everything the descriptor cannot carry. */
export interface AppShellSeams {
  /** REQUIRED. See the note at the top of this file. */
  routing: ShellRouting;

  // ⛔ NO ICON SLOT HERE, deliberately. `NavNode.icon` and `Command.icon` are keys, and
  // meridian already has the seam that resolves them: `MeridianProvider.renderIcon`, read
  // through `useIcon` — the same one mui-kit's content views use. A second icon map on this
  // object would let a host's nav glyphs and its panel glyphs be resolved by two different
  // rules, and the two would drift.

  /**
   * Turn a nav leaf into an href.
   *
   * Normally unnecessary — a leaf that sets `route` already carries its href. This is for
   * the other two arms: a `panelId`/`viewId` leaf has no URL of its own, and only the host
   * knows which URL shows that panel. Returning `undefined` renders the node as an inert
   * label rather than a dead link.
   */
  hrefFor?: (node: NavNodeLike) => string | undefined;

  /** Rendered at the header start. Absent ⇒ `brand_text`, then `title`. */
  brandLogo?: React.ReactNode;

  /**
   * Host chrome rendered in the app bar, just before the identity menu.
   *
   * For the controls that are NOT navigation and therefore cannot be a `NavNode`: a theme
   * switch, an environment badge, a notifications bell. `NavNode` is a label and a target —
   * a three-way light/auto/dark toggle is neither, and encoding it as one would mean
   * inventing a pseudo-route whose only job is to be intercepted.
   *
   * Also the home for links that are deliberately OFF-ROUTER — an admin console on another
   * origin, a logout that must hit the IdP rather than a client route. The descriptor's
   * `user_menu` is for destinations inside the app; these are not.
   */
  headerActions?: React.ReactNode;

  /**
   * Host chrome rendered in the page-header row, above the page content.
   *
   * Normally breadcrumbs. Deliberately a NODE rather than descriptor data: a breadcrumb trail
   * is derived from the host's route table and its loaded record ("Teams / Acme / Members"),
   * which the shell cannot see and which changes on every navigation. The shell owns the ROW
   * — its placement, its divider, and the fact that `pageActions` shares it — and the host
   * owns what the trail says.
   */
  pageChrome?: React.ReactNode;

  /**
   * Called when the scope selector changes.
   *
   * The descriptor says what may be chosen and what is chosen now; changing it is an action
   * only the host can perform — it may re-query, re-route, or write a cookie.
   */
  onScopeChange?: (id: string) => void;

  /**
   * The dock's content — normally `<Conversation>` from `@savvifi/meridian-chat`.
   *
   * A node, not a chat client. The shell owns the DOCK (width, the reflow of the main
   * column, the toggle); it does not own the transport, and `@savvifi/meridian-chat` stays
   * an OPTIONAL peer so an app with no chat pays nothing. This is the seam that host's own
   * `chat-dock.tsx` predicted: it mounts `<Conversation>` as a sibling of the shell and says
   * that "if the dock ever needs to reflow the sidebar or share the shell's hotkey registry
   * it should move into the shell's chromeCapabilities."
   */
  chatPanel?: React.ReactNode;
}

/** What the shell is mounted with: the descriptor, plus the seams. */
export interface AppShellProps {
  shell: AppShell;
  seams: AppShellSeams;
  children?: React.ReactNode;
}

/** The scope selector's resolved view — descriptor data plus the host's callback. */
export interface ResolvedScope {
  selector: ScopeSelector;
  onChange: (id: string) => void;
}

export function resolveScope(shell: AppShell, seams: AppShellSeams): ResolvedScope | undefined {
  const selector = shell.scope;
  if (!selector || selector.options.length === 0) return undefined;
  // ⛔ A selector with no handler is not rendered rather than rendered inert. A dropdown that
  // visibly does nothing reads as a broken app; its absence reads as an app that is not
  // scoped, which is the truth when the host wired no callback.
  const onChange = seams.onScopeChange;
  if (!onChange) return undefined;
  return { selector, onChange };
}

/** The wordmark, in priority order: host node, then `brand_text`, then `title`. */
export function brandOf(shell: AppShell, seams: AppShellSeams): React.ReactNode | string {
  return seams.brandLogo ?? (shell.brandText || shell.title);
}
