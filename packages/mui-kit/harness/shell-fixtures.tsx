// App-shell fixtures for the browser harness and the visual catalog.
//
// The frame is the one thing in this kit that cannot be judged from a unit test. `isActive`
// and the launchpad ranking are pure and pinned in `tests/`; whether the rail actually
// reserves its width, whether the dock reflows the content instead of covering it, and
// whether the app bar sits above the drawer are all layout — and layout only exists in a
// browser.
//
// The seams are stubbed with the smallest thing that is honest: `Link` is a plain anchor and
// `usePathname` returns a fixed path, because the fixture is testing the FRAME, not a router.

import { create } from "@bufbuild/protobuf";
import { createElement, type ReactNode } from "react";

import {
  CommandGroupSchema,
  CommandSchema,
  LaunchpadSchema,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { NavNodeSchema, NavTreeSchema } from "@savvifi/meridian-proto-ts/proto/nav_tree_pb.js";
import {
  AppShellSchema,
  ChatDockSchema,
  ScopeOptionSchema,
  ScopeSelectorSchema,
} from "@savvifi/meridian-proto-ts/proto/shell_pb.js";

import { AppShellView, usePageActions } from "../src/shell/index.js";
import type { AppShellSeams } from "../src/shell/index.js";

function leaf(id: string, label: string, route: string, icon = "", badge = "") {
  return create(NavNodeSchema, {
    id,
    label,
    icon,
    badge,
    target: { case: "route", value: route },
  });
}

const NAV = create(NavTreeSchema, {
  roots: [
    leaf("dashboard", "Dashboard", "/"),
    leaf("sponsors", "Sponsors", "/sponsors"),
    leaf("plan-years", "Plan years", "/plan-years"),
    leaf("tasks", "Tasks", "/tasks", "", "3"),
    create(NavNodeSchema, {
      id: "admin",
      label: "Administration",
      defaultOpen: true,
      children: [
        leaf("teams", "Teams", "/teams"),
        leaf("platforms", "Platforms", "/platforms"),
        // A leaf whose target the host cannot resolve — renders inert, never as a dead link.
        create(NavNodeSchema, {
          id: "orphan",
          label: "Unresolvable panel",
          target: { case: "panelId", value: "no-such-panel" },
        }),
      ],
    }),
  ],
});

const LAUNCHPAD = create(LaunchpadSchema, {
  placeholder: "Search or jump to…",
  defaultCommandIds: ["go-sponsors"],
  groups: [
    create(CommandGroupSchema, {
      id: "create",
      title: "Create",
      commands: [
        create(CommandSchema, {
          id: "new-sponsor",
          title: "Create sponsor",
          subtitle: "A new sponsoring organization",
          keywords: ["client", "new"],
          action: { case: "navigate", value: { route: "/sponsors/new" } },
        }),
        create(CommandSchema, {
          id: "new-team",
          title: "Create team",
          action: { case: "navigate", value: { route: "/teams/new" } },
        }),
      ],
    }),
    create(CommandGroupSchema, {
      id: "go",
      title: "Navigate",
      commands: [
        create(CommandSchema, {
          id: "go-sponsors",
          title: "Sponsors",
          shortcut: "g s",
          action: { case: "navigate", value: { route: "/sponsors" } },
        }),
        create(CommandSchema, {
          id: "go-teams",
          title: "Teams",
          action: { case: "navigate", value: { route: "/teams" } },
        }),
      ],
    }),
  ],
});

const SCOPE = create(ScopeSelectorSchema, {
  label: "Organization",
  selectedId: "acme",
  helperText: "Applies to every list",
  options: [
    create(ScopeOptionSchema, { id: "acme", label: "Acme Benefits" }),
    create(ScopeOptionSchema, { id: "northwind", label: "Northwind" }),
  ],
});

/** A plain anchor: the fixture exercises the frame, not a router. */
const seams: AppShellSeams = {
  routing: {
    Link: ({ href, children, ...rest }) =>
      createElement("a", { href, ...(rest as object) }, children as ReactNode),
    usePathname: () => "/sponsors",
  },
  onScopeChange: () => {},
};

const FULL = create(AppShellSchema, {
  title: "savvi Studio",
  brandText: "savvi Studio",
  nav: NAV,
  launchpad: LAUNCHPAD,
  scope: SCOPE,
  headerLinks: [leaf("docs", "Docs", "/docs")],
  userMenu: [leaf("profile", "Profile", "/profile"), leaf("logout", "Sign out", "/auth/logout")],
  primaryNavIds: ["dashboard", "sponsors", "tasks"],
});

/**
 * ⛔ The entitlement case, and the reason it is a FIXTURE rather than a unit test.
 *
 * A caller who may not browse is served a frame with no `nav` and no `launchpad` — not a
 * frame that receives them and hides them. What has to be visible here is that the rail is
 * ABSENT and the content starts at the left edge: if the shell merely hid the drawer while
 * still reserving its width, every unit test would still pass and the page would have a
 * 280px hole in it.
 */
const RESTRICTED = create(AppShellSchema, {
  title: "savvi Studio",
  brandText: "savvi Studio",
  userMenu: [leaf("logout", "Sign out", "/auth/logout")],
});

const WITH_CHAT = create(AppShellSchema, {
  ...FULL,
  chat: create(ChatDockSchema, { enabled: true, defaultOpen: true, title: "Assistant" }),
});

function body(text: string): ReactNode {
  return createElement(
    "div",
    { style: { padding: 24 } },
    createElement("h2", { style: { marginTop: 0 } }, "Sponsors"),
    createElement("p", null, text),
  );
}

/**
 * A page that publishes its own toolbar action, exactly as a real list page does — with an
 * INLINE, unmemoized element.
 *
 * ⛔ The unmemoized part is the point. Publishing used to re-render the publisher, which made
 * a fresh element, which re-published: a loop that ends in "Maximum update depth exceeded".
 * A fixture that memoized would render correctly and prove nothing.
 */
function SponsorsPage() {
  usePageActions(
    createElement(
      "button",
      { type: "button", style: { padding: "4px 10px" } },
      "Create sponsor",
    ),
  );
  return body("The action above sits in the page-header row, beside the breadcrumbs.");
}

export interface ShellFixture {
  name: string;
  label: string;
  group: string;
  element: () => ReactNode;
  mode?: "light" | "dark";
}

export const SHELL_FIXTURES: ShellFixture[] = [
  {
    name: "shell-full",
    label: "App shell · rail, launchpad, scope",
    group: "Shell",
    element: () =>
      createElement(AppShellView, { shell: FULL, seams }, body("A frame with everything.")),
  },
  {
    name: "shell-restricted",
    label: "App shell · no nav (entitlement)",
    group: "Shell",
    element: () =>
      createElement(
        AppShellView,
        { shell: RESTRICTED, seams },
        body("No rail, because the descriptor carries none."),
      ),
  },
  {
    name: "shell-chat",
    label: "App shell · assistant docked",
    group: "Shell",
    element: () =>
      createElement(
        AppShellView,
        {
          shell: WITH_CHAT,
          seams: {
            ...seams,
            chatPanel: createElement(
              "div",
              { style: { padding: 16 } },
              "The host's conversation renders here.",
            ),
          },
        },
        body("The dock reserves width; it does not cover this."),
      ),
  },
  {
    name: "shell-page-header",
    label: "App shell · breadcrumbs, page actions, header chrome",
    group: "Shell",
    element: () =>
      createElement(
        AppShellView,
        {
          shell: FULL,
          seams: {
            ...seams,
            pageChrome: createElement(
              "nav",
              { style: { fontSize: 13, opacity: 0.75 } },
              "Sponsors / Acme Benefits",
            ),
            headerActions: createElement(
              "button",
              { type: "button", style: { padding: "2px 8px", marginRight: 8 } },
              "Dark",
            ),
          },
        },
        createElement(SponsorsPage),
      ),
  },
  {
    name: "shell-dark",
    label: "App shell · dark",
    group: "Shell",
    mode: "dark",
    element: () =>
      createElement(AppShellView, { shell: FULL, seams }, body("The same frame, dark.")),
  },
];
