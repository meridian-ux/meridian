// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { readFrozen } from "../../../schemas/tests/frozen_affordance.js";
import {
  CommandGroupSchema,
  CommandSchema,
  LaunchpadSchema,
  type Command,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { safeNavigationHref } from "@savvifi/meridian-schemas/uiview";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Launchpad } from "../src/index.js";

const invoker = { invoke: async () => ({}) };

afterEach(cleanup);

function descriptor(command: Command) {
  return create(LaunchpadSchema, {
    groups: [create(CommandGroupSchema, { id: "navigation", commands: [command] })],
  });
}

function mount(command: Command, onNavigate = vi.fn(), onClose = vi.fn()) {
  render(
    createElement(
      MeridianProvider,
      { invoker, kit: htmlKit, adhoc: {}, invocation: { admit: () => true, capabilities: {
        navigate: async target => { onNavigate(safeNavigationHref(target.route)); },
        uri: async uri => { window.location.assign(safeNavigationHref(uri)!); },
      } }, children: createElement(Launchpad, {
        descriptor: descriptor(command),
        open: true,
        onClose,
        onNavigate,
      }) },
    ),
  );
  return { onNavigate, onClose };
}

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
    restore: () => Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: original,
    }),
  };
}

describe("<Launchpad> navigation admission", () => {
  it("uses an explicitly admitted canonical app URI, not legacy hints or actions", async () => {
    const location = spyOnAssign();
    const command = readFrozen(CommandSchema, {
      id: "editor",
      title: "Open editor",
      deepLink: "cursor://must-not-run",
      navigate: { route: "/must-not-run" },
      affordance: { label: "Open editor", uri: "cursor://file/workspace/readme" },
    });
    const { onNavigate, onClose } = mount(command);

    fireEvent.click(screen.getByRole("option", { name: "Open editor" }));

    await waitFor(() => expect(location.assign).toHaveBeenCalledWith("cursor://file/workspace/readme"));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    location.restore();
  });

  it.each(["javascript:alert(1)", "cursor://file/workspace/readme"])("keeps legacy-only deep link %s inert without falling through to its action", deepLink => {
    const location = spyOnAssign();
    const command = readFrozen(CommandSchema, {
      id: "unsafe-editor",
      title: "Unsafe editor",
      deepLink,
      navigate: { route: "/must-not-run" },
    });
    const { onNavigate, onClose } = mount(command);
    const option = screen.getByRole("option", { name: "Unsafe editor" });

    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("no canonical target");
    fireEvent.click(option);
    expect(location.assign).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    location.restore();
  });

  it("admits safe routes with explicit capability and disables unsafe navigate actions", async () => {
    const safe = create(CommandSchema, {
      id: "safe-route",
      title: "Safe route",
      deepLink: "javascript:must-not-override-canonical-target",
      affordance: { label: "Safe route", invoke: { case: "navigate", value: { route: " /builds?status=failing " } } },
    });
    const safeMount = mount(safe);
    fireEvent.click(screen.getByRole("option", { name: "Safe route" }));
    await waitFor(() => expect(safeMount.onNavigate).toHaveBeenCalledWith("/builds?status=failing"));
    cleanup();

    const unsafe = create(CommandSchema, {
      id: "unsafe-route",
      title: "Unsafe route",
      affordance: { label: "Unsafe route", invoke: { case: "navigate", value: { route: "data:text/html,unsafe" } } },
    });
    const unsafeMount = mount(unsafe);
    const option = screen.getByRole("option", { name: "Unsafe route" });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(option);
    expect(unsafeMount.onNavigate).not.toHaveBeenCalled();
    expect(unsafeMount.onClose).not.toHaveBeenCalled();
  });
});
