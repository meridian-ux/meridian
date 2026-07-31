// The frame's behaviour, as opposed to its pure helpers (shell_nav / shell_launchpad).
//
// Everything here covers something that was WRONG in 0.16.0 and silent about it:
//
//   • `usePageActions` stored its node in context and no view read it — a page published a
//     "Create" button and got a no-op with a correct-looking call site.
//   • reading the setter through `useShell()` subscribed the publisher to its own
//     publication, which is a render loop for any caller that does not memoize.
//   • the launchpad navigated with `window.location.assign`, re-booting the document on the
//     one path that exists to be fast.
//   • `displayKeys` defaulted the platform from `navigator` at call time, so the server and
//     the hydrating render disagreed.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";

import { CommandGroupSchema, CommandSchema, LaunchpadSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { NavNodeSchema, NavTreeSchema } from "@savvifi/meridian-proto-ts/proto/nav_tree_pb.js";
import { AppShellSchema } from "@savvifi/meridian-proto-ts/proto/shell_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";
import { AppShellView, usePageActions, displayKeys, SHELL_HOTKEYS } from "../src/shell/index.js";
import type { AppShellSeams } from "../src/shell/index.js";

afterEach(cleanup);

const invoker: RpcInvoker = { invoke: async () => ({}) };

const Link = React.forwardRef<HTMLAnchorElement, { href: string; children?: React.ReactNode }>(
  function Link({ href, children, ...rest }, ref) {
    return (
      <a ref={ref} href={href} {...rest}>
        {children}
      </a>
    );
  },
);

function leaf(id: string, label: string, route: string) {
  return create(NavNodeSchema, { id, label, target: { case: "route", value: route } });
}

function shellWith(overrides: Parameters<typeof create<typeof AppShellSchema>>[1] = {}) {
  return create(AppShellSchema, {
    title: "Test App",
    nav: create(NavTreeSchema, { roots: [leaf("teams", "Teams", "/teams")] }),
    ...overrides,
  });
}

function mount(seams: Partial<AppShellSeams>, children?: React.ReactNode, shell = shellWith()) {
  return render(
    <MeridianMuiProvider invoker={invoker}>
      <AppShellView shell={shell} seams={{ routing: { Link, usePathname: () => "/" }, ...seams }}>
        {children}
      </AppShellView>
    </MeridianMuiProvider>,
  );
}

describe("the page-header row", () => {
  it("renders a page's published actions", () => {
    function Page() {
      usePageActions(<button type="button">Create sponsor</button>);
      return <p>page body</p>;
    }
    mount({}, <Page />);
    expect(screen.getByText("Create sponsor")).toBeTruthy();
  });

  it("renders host chrome in the same row", () => {
    mount({ pageChrome: <nav>Teams / Acme</nav> });
    expect(screen.getByText("Teams / Acme")).toBeTruthy();
  });

  it("renders NOTHING when the host supplies neither", () => {
    // ⛔ Not "renders an empty bar". A shell used as a plain frame must not reserve height or
    // draw a divider for a row with nothing in it.
    const { container } = mount({}, <p>page body</p>);
    const main = container.querySelector("main");
    // The toolbar spacer, then the page. No third child.
    expect(main?.children.length).toBe(2);
  });

  it("⛔ does not loop when the published node is not memoized", () => {
    // This is the regression that matters. With the setter read through `useShell()`, setting
    // `pageActions` re-renders the publisher, whose inline JSX is a new element every render,
    // which re-fires the effect — React aborts with "Maximum update depth exceeded". An
    // unmemoized inline node is what every real call site writes, so the hook has to survive
    // it rather than document its way out.
    let renders = 0;
    function Page() {
      renders += 1;
      usePageActions(<button type="button">Create sponsor</button>);
      return <p>page body</p>;
    }
    expect(() => mount({}, <Page />)).not.toThrow();
    expect(screen.getByText("Create sponsor")).toBeTruthy();
    expect(renders).toBeLessThan(5);
  });

  it("takes the actions down when the page unmounts", () => {
    // Without the teardown, navigating from Sponsors to Plan Years leaves a "Create sponsor"
    // button above the plan-year list, wired to the wrong flow.
    function Page() {
      usePageActions(<button type="button">Create sponsor</button>);
      return <p>page body</p>;
    }
    function Host({ show }: { show: boolean }) {
      return (
        <MeridianMuiProvider invoker={invoker}>
          <AppShellView shell={shellWith()} seams={{ routing: { Link, usePathname: () => "/" } }}>
            {show ? <Page /> : <p>other page</p>}
          </AppShellView>
        </MeridianMuiProvider>
      );
    }
    const { rerender } = render(<Host show />);
    expect(screen.getByText("Create sponsor")).toBeTruthy();
    rerender(<Host show={false} />);
    expect(screen.queryByText("Create sponsor")).toBeNull();
  });
});

describe("header actions", () => {
  it("renders host chrome in the app bar", () => {
    mount({ headerActions: <button type="button">Dark mode</button> });
    expect(screen.getByText("Dark mode")).toBeTruthy();
  });
});

/**
 * Spy on `window.location.assign`.
 *
 * jsdom defines `assign` as non-configurable, so `vi.spyOn` throws "Cannot redefine property".
 * Swapping the whole `location` object is the supported way round it.
 */
function spyOnAssign(): { assign: ReturnType<typeof vi.fn>; restore: () => void } {
  const original = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...original, assign },
  });
  return {
    assign,
    restore: () =>
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: original,
      }),
  };
}

describe("the launchpad navigates through the host's router", () => {
  const withLaunchpad = shellWith({
    launchpad: create(LaunchpadSchema, {
      groups: [
        create(CommandGroupSchema, {
          id: "go",
          title: "Go to",
          commands: [
            create(CommandSchema, {
              id: "teams",
              title: "Teams",
              action: { case: "navigate", value: { route: "/teams" } },
            }),
          ],
        }),
      ],
    }),
  });

  it("⛔ calls the navigate seam, not window.location", () => {
    const navigate = vi.fn();
    const location = spyOnAssign();
    mount({ routing: { Link, usePathname: () => "/", navigate } }, undefined, withLaunchpad);

    fireEvent.click(screen.getByLabelText("Open the launchpad"));
    // ⛔ Scoped to the dialog: "Teams" is a rail item too, so an unscoped query matches twice.
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Teams"));

    expect(navigate).toHaveBeenCalledWith("/teams");
    expect(location.assign).not.toHaveBeenCalled();
    location.restore();
  });

  it("falls back to a document load only when the host supplied no navigate", () => {
    const location = spyOnAssign();
    mount({}, undefined, withLaunchpad);

    fireEvent.click(screen.getByLabelText("Open the launchpad"));
    // ⛔ Scoped to the dialog: "Teams" is a rail item too, so an unscoped query matches twice.
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Teams"));

    expect(location.assign).toHaveBeenCalledWith("/teams");
    location.restore();
  });
});

describe("displayKeys", () => {
  it("⛔ defaults to the non-Apple glyph, so the server and the hydrating render agree", () => {
    // The platform is a client-only fact. `useIsApplePlatform` upgrades this after mount;
    // what must never happen is this function reaching for `navigator` on its own.
    const launchpad = SHELL_HOTKEYS.find((hotkey) => hotkey.id === "launchpad")!;
    expect(displayKeys(launchpad)).toEqual(["Ctrl", "K"]);
    expect(displayKeys(launchpad, true)).toEqual(["⌘", "K"]);
  });
});
