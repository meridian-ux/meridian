// @vitest-environment jsdom
//
// The AI-launchpad seam: a query is debounce-handed to onResolveQuery (the host's
// agent), and the returned Commands surface in the palette and run through the
// same dispatch. Uses fake timers to drive the ~250ms debounce deterministically.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

import { create } from "@bufbuild/protobuf";
import { CommandSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";

import { Launchpad } from "../src/index.js";
import { demoLaunchpad } from "./fixtures.js";

const invoker = { invoke: async () => ({}) };

afterEach(() => {
  vi.useRealTimers();
});

function renderLaunchpad(props: Record<string, unknown>) {
  return render(
    createElement(
      MeridianProvider,
      { invoker, kit: htmlKit, adhoc: {} },
      createElement(Launchpad, {
        descriptor: demoLaunchpad(),
        open: true,
        onClose: () => {},
        ...props,
      }),
    ),
  );
}

describe("<Launchpad> agent seam", () => {
  it("surfaces agent-resolved commands for a query and runs them", async () => {
    vi.useFakeTimers();
    const agentCommand = create(CommandSchema, {
      id: "agent-1",
      title: "Agent: open failing builds",
      action: { case: "navigate", value: { route: "/builds?status=failing" } },
    });
    const onResolveQuery = vi.fn(async (q: string) => (q ? [agentCommand] : []));
    const onNavigate = vi.fn();

    renderLaunchpad({ onResolveQuery, onNavigate });

    const input = screen.getByPlaceholderText(/Search or jump/i);
    fireEvent.change(input, { target: { value: "failing builds" } });

    // Fire the debounce timer + flush the resolver promise.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onResolveQuery).toHaveBeenCalledWith("failing builds");

    // The agent command appears under its group and dispatches like any command.
    const row = screen.getByText("Agent: open failing builds");
    fireEvent.mouseDown(row);
    expect(onNavigate).toHaveBeenCalledWith("/builds?status=failing");
  });

  it("does not call the resolver for an empty query", () => {
    const onResolveQuery = vi.fn(async () => []);
    renderLaunchpad({ onResolveQuery });
    expect(onResolveQuery).not.toHaveBeenCalled();
  });
});
