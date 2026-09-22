// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import {
  CommandGroupSchema,
  CommandSchema,
  LaunchpadSchema,
  type Command,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      { invoker, kit: htmlKit, adhoc: {} },
      createElement(Launchpad, {
        descriptor: descriptor(command),
        open: true,
        onClose,
        onNavigate,
      }),
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
  it("gives an admitted deep link precedence over its fallback action", () => {
    const location = spyOnAssign();
    const command = create(CommandSchema, {
      id: "editor",
      title: "Open editor",
      deepLink: "cursor://file/workspace/readme",
      action: { case: "navigate", value: { route: "/must-not-run" } },
    });
    const { onNavigate, onClose } = mount(command);

    fireEvent.mouseDown(screen.getByRole("option", { name: "Open editor" }));

    expect(location.assign).toHaveBeenCalledWith("cursor://file/workspace/readme");
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    location.restore();
  });

  it("disables an unsafe deep link without falling through to its action", () => {
    const location = spyOnAssign();
    const command = create(CommandSchema, {
      id: "unsafe-editor",
      title: "Unsafe editor",
      deepLink: "javascript:alert(1)",
      action: { case: "navigate", value: { route: "/must-not-run" } },
    });
    const { onNavigate, onClose } = mount(command);
    const option = screen.getByRole("option", { name: "Unsafe editor" });

    expect(option.getAttribute("aria-disabled")).toBe("true");
    fireEvent.mouseDown(option);
    expect(location.assign).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    location.restore();
  });

  it("admits safe routes and disables unsafe navigate actions", () => {
    const safe = create(CommandSchema, {
      id: "safe-route",
      title: "Safe route",
      action: { case: "navigate", value: { route: " /builds?status=failing " } },
    });
    const safeMount = mount(safe);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Safe route" }));
    expect(safeMount.onNavigate).toHaveBeenCalledWith("/builds?status=failing");
    cleanup();

    const unsafe = create(CommandSchema, {
      id: "unsafe-route",
      title: "Unsafe route",
      action: { case: "navigate", value: { route: "data:text/html,unsafe" } },
    });
    const unsafeMount = mount(unsafe);
    const option = screen.getByRole("option", { name: "Unsafe route" });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    fireEvent.mouseDown(option);
    expect(unsafeMount.onNavigate).not.toHaveBeenCalled();
    expect(unsafeMount.onClose).not.toHaveBeenCalled();
  });
});
