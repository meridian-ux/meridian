// What the frame can do, and the keys that do it.
//
// ⛔ CAPABILITIES ARE DERIVED FROM THE DESCRIPTOR, not from a session.
//
// aion computes this from roles — `resolveAppChromeMode(session)` returns "full" for a
// platform admin and "restricted" for everyone else, and the shell then hides a sidebar it
// was still handed. hatch inherited the same shape. Both are asking the wrong question: the
// shell has no business knowing what a role is, and a frame that receives a nav tree it must
// not show has already been given the thing it is hiding.
//
// A hidden nav item is still a list of your surfaces, delivered to someone who may not use
// them. So the descriptor answers instead: a caller who may not browse is served an
// `AppShell` with no `nav`, and the rail is absent because there is nothing to render — not
// because a boolean said so. `LayoutService.GetAppShell` exists to make that the normal
// path.
//
// The practical consequence is that a host with a static descriptor gets the same behaviour
// for free: omit `launchpad` and no ⌘K is bound, with no capability flag to keep in step.

import type { AppShell } from "@savvifi/meridian-proto-ts/proto/shell_pb.js";

export interface ShellCapabilities {
  sidebar: boolean;
  launchpad: boolean;
  hotkeyHelp: boolean;
  chat: boolean;
}

export function capabilitiesOf(shell: AppShell): ShellCapabilities {
  const sidebar = (shell.nav?.roots?.length ?? 0) > 0;
  const launchpad = (shell.launchpad?.groups?.length ?? 0) > 0;
  const chat = shell.chat?.enabled === true;
  return {
    sidebar,
    launchpad,
    chat,
    // Nothing to explain when nothing is bound. A shortcuts sheet listing zero shortcuts is
    // worse than no sheet.
    hotkeyHelp: sidebar || launchpad,
  };
}

export type ShellHotkeyId = "launchpad" | "sidebar-toggle" | "hotkey-help";

export interface ShellHotkey {
  id: ShellHotkeyId;
  /** The physical key, without the modifier. Matched case-insensitively. */
  key: string;
  displayKeys: string[];
  description: string;
  /**
   * Whether the binding still fires while a text field has focus.
   *
   * ⌘K must (you summon the palette from anywhere, including mid-typing). ⌘\ must not —
   * a user toggling the sidebar by accident while writing is a worse outcome than having
   * to click.
   */
  allowInEditableTargets?: boolean;
}

export const SHELL_HOTKEYS: readonly ShellHotkey[] = [
  {
    id: "launchpad",
    key: "k",
    displayKeys: ["$mod", "K"],
    description: "Open the launchpad",
    allowInEditableTargets: true,
  },
  {
    id: "sidebar-toggle",
    key: "\\",
    displayKeys: ["$mod", "\\"],
    description: "Toggle the sidebar",
  },
  {
    id: "hotkey-help",
    key: "/",
    displayKeys: ["$mod", "/"],
    description: "Keyboard shortcuts",
    allowInEditableTargets: true,
  },
];

export function isHotkeyEnabled(id: ShellHotkeyId, capabilities: ShellCapabilities): boolean {
  switch (id) {
    case "launchpad":
      return capabilities.launchpad;
    case "sidebar-toggle":
      return capabilities.sidebar;
    case "hotkey-help":
      return capabilities.hotkeyHelp;
    default:
      return false;
  }
}

/**
 * The glyphs to draw for a binding.
 *
 * ⛔ Takes the platform as an argument, defaulting to a value that is EMPTY on the server.
 * `navigator.platform` is deprecated and absent during SSR, so reading it at module scope
 * throws in node and — worse — produces a different string on the server than in the
 * browser, which is a hydration mismatch on a chip in the header. An empty platform falls
 * back to "Ctrl": one wrong glyph, rather than a render that does not reconcile.
 */
export function displayKeys(
  hotkey: ShellHotkey,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string[] {
  const apple = /Mac|iPhone|iPad|iPod/i.test(platform);
  return hotkey.displayKeys.map((key) => {
    if (key === "$mod") return apple ? "⌘" : "Ctrl";
    if (key === "Shift") return apple ? "⇧" : "Shift";
    return key;
  });
}

/** Is the event target something a keystroke belongs to? */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

/** The hotkey a keydown should fire, or `undefined`. */
export function matchHotkey(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "target">,
  capabilities: ShellCapabilities,
): ShellHotkey | undefined {
  if (!event.metaKey && !event.ctrlKey) return undefined;
  const editable = isEditableTarget(event.target);
  return SHELL_HOTKEYS.find((hotkey) => {
    if (!isHotkeyEnabled(hotkey.id, capabilities)) return false;
    if (editable && !hotkey.allowInEditableTargets) return false;
    return event.key.toLowerCase() === hotkey.key.toLowerCase();
  });
}
