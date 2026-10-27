// @vitest-environment jsdom
//
// The AI-launchpad seam: a query is debounce-handed to onResolveQuery (the host's
// agent), and the returned Commands surface in the palette and run through the
// same dispatch. Uses fake timers to drive the ~250ms debounce deterministically.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

import { create } from "@bufbuild/protobuf";
import { CommandSchema, type Command } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";

import { Launchpad, type LaunchpadProps } from "../src/index.js";
import { demoLaunchpad } from "./fixtures.js";

const invoker = { invoke: async () => ({}) };

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderLaunchpad(props: Record<string, unknown>) {
  return render(
    createElement(
      MeridianProvider,
      { invoker, kit: htmlKit, adhoc: {}, invocation: { admit: () => true, capabilities: {
        navigate: async target => { (props.onNavigate as ((route: string) => void) | undefined)?.(target.route); },
      } }, children: createElement(Launchpad, {
        descriptor: demoLaunchpad(),
        open: true,
        onClose: () => {},
        ...props,
      }) },
    ),
  );
}

describe("<Launchpad> agent seam", () => {
  it("cancels the debounce while closed and ignores a result from a closed session", async () => {
    vi.useFakeTimers();
    let resolve!: (commands: Command[]) => void;
    const command = create(CommandSchema, { id: "stale", title: "Old session command", affordance: { label: "Old session command", invoke: { case: "navigate", value: { route: "/old" } } } });
    const resolver = vi.fn(() => new Promise<typeof command[]>(done => { resolve = done; }));
    const descriptor = demoLaunchpad();
    const view = (open: boolean) => createElement(MeridianProvider, { invoker, kit: htmlKit, adhoc: {}, children:
      createElement(Launchpad, { descriptor, open, onClose: () => {}, onResolveQuery: resolver }) });
    const { rerender } = render(view(true));
    fireEvent.change(screen.getByPlaceholderText(/Search or jump/i), { target: { value: "old query" } });
    rerender(view(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(resolver).not.toHaveBeenCalled();
    rerender(view(true));
    fireEvent.change(screen.getByPlaceholderText(/Search or jump/i), { target: { value: "pending query" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(resolver).toHaveBeenCalledTimes(1);
    rerender(view(false));
    await act(async () => { resolve([command]); });
    rerender(view(true));
    expect(screen.queryByText(command.title)).toBeNull();
  });

  it("withdraws old commands on query changes, resolver replacement, and removal", async () => {
    vi.useFakeTimers();
    const command = create(CommandSchema, { id: "old", title: "Old result", affordance: { label: "Old result", invoke: { case: "navigate", value: { route: "/old" } } } });
    const resolver = vi.fn(async () => [command]);
    const replacement = vi.fn(async () => []);
    const descriptor = demoLaunchpad();
    const view = (onResolveQuery?: LaunchpadProps["onResolveQuery"]) => createElement(MeridianProvider, { invoker, kit: htmlKit, adhoc: {}, children:
      createElement(Launchpad, { descriptor, open: true, onClose: () => {}, onResolveQuery }) });
    const { rerender } = render(view(resolver));
    const input = screen.getByPlaceholderText(/Search or jump/i);
    fireEvent.change(input, { target: { value: "first query" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByText(command.title)).not.toBeNull();
    fireEvent.change(input, { target: { value: "second query" } });
    expect(screen.queryByText(command.title)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByText(command.title)).not.toBeNull();
    rerender(view(replacement));
    expect(screen.queryByText(command.title)).toBeNull();
    rerender(view(resolver));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByText(command.title)).not.toBeNull();
    rerender(view());
    expect(screen.queryByText(command.title)).toBeNull();
    expect(screen.queryByText("Asking the agent…")).toBeNull();
  });

  it.each([false, true])("resolver failure is contained (synchronous=%s)", async synchronous => {
    vi.useFakeTimers();
    const resolver = vi.fn(() => {
      if (synchronous) throw new Error("host failure");
      return Promise.reject(new Error("host failure"));
    });
    renderLaunchpad({ onResolveQuery: resolver });
    fireEvent.change(screen.getByPlaceholderText(/Search or jump/i), { target: { value: "no matching query" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Asking the agent…")).toBeNull();
    expect(screen.queryByText("No matching commands")).not.toBeNull();
  });

  it("ignores a superseded resolver result and cancels unmounted debounce work", async () => {
    vi.useFakeTimers();
    const pending = new Map<string, (commands: Command[]) => void>();
    const resolver = vi.fn((query: string) => new Promise<Command[]>(resolve => { pending.set(query, resolve); }));
    const makeCommand = (id: string) => create(CommandSchema, { id, title: `${id} result`, affordance: { label: `${id} result`, invoke: { case: "navigate", value: { route: `/${id}` } } } });
    const { unmount } = renderLaunchpad({ onResolveQuery: resolver });
    const input = screen.getByPlaceholderText(/Search or jump/i);
    fireEvent.change(input, { target: { value: "first" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    fireEvent.change(input, { target: { value: "second" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { pending.get("second")!([makeCommand("second")]); });
    await act(async () => { pending.get("first")!([makeCommand("first")]); });
    expect(screen.queryByText("first result")).toBeNull();
    expect(screen.queryByText("second result")).not.toBeNull();
    fireEvent.change(input, { target: { value: "unmounted" } });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(resolver.mock.calls.map(([query]) => query)).toEqual(["first", "second"]);
  });

  it("surfaces agent-resolved commands for a query and runs them", async () => {
    vi.useFakeTimers();
    const agentCommand = create(CommandSchema, {
      id: "agent-1",
      title: "Agent: open failing builds",
      affordance: { label: "Agent: open failing builds", invoke: { case: "navigate", value: { route: "/builds?status=failing" } } },
    });
    const onResolveQuery = vi.fn(async (q: string) => (q ? [agentCommand] : []));
    const onNavigate = vi.fn();
    const onRun = vi.fn();

    renderLaunchpad({ onResolveQuery, onNavigate, onRun });

    const input = screen.getByPlaceholderText(/Search or jump/i);
    fireEvent.change(input, { target: { value: "failing builds" } });

    // Fire the debounce timer + flush the resolver promise.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onResolveQuery).toHaveBeenCalledWith("failing builds");

    // The agent command appears under its group and dispatches like any command.
    const row = screen.getByText("Agent: open failing builds");
    await act(async () => { fireEvent.click(row); });
    expect(onNavigate).toHaveBeenCalledWith("/builds?status=failing");
    expect(onRun).toHaveBeenCalledWith(agentCommand);
  });

  it("does not call the resolver for an empty query", () => {
    const onResolveQuery = vi.fn(async () => []);
    renderLaunchpad({ onResolveQuery });
    expect(onResolveQuery).not.toHaveBeenCalled();
  });

  it.each(["count", "bytes"])("rejects agent results exceeding aggregate %s limits before mounting controls", async mode => {
    vi.useFakeTimers();
    const command = create(CommandSchema, { id: "oversized", title: "Oversized agent result", keywords: mode === "bytes" ? ["x".repeat(800_000)] : [] });
    const onResolveQuery = vi.fn(async () => mode === "count" ? Array.from({ length: 1001 }, () => command) : [command]);
    renderLaunchpad({ onResolveQuery });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "unmatched agent query" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(onResolveQuery).toHaveBeenCalledOnce(); expect(screen.queryByText("Oversized agent result")).toBeNull();
    expect(screen.getByText("No matching commands")).toBeDefined();
  });

  it("routes rpc commands through the mutation admission boundary", async () => {
    const calls: string[] = [];
    const denials: Array<{ tier: string; service: string; method: string }> = [];
    render(
      createElement(
        MeridianProvider,
        {
          invoker: { invoke: async (_service: string, method: string) => { calls.push(method); return {}; } },
          admission: { onDenied: (denial) => denials.push(denial) },
          kit: htmlKit,
          adhoc: {},
          children: createElement(Launchpad, { descriptor: demoLaunchpad(), open: true, onClose: () => {} }),
        },
      ),
    );

    await act(async () => { fireEvent.click(screen.getByText("Export data")); });

    expect(calls).toEqual([]);
    expect(denials).toMatchObject([{ tier: "mutation", service: "acme.v1.Exporter", method: "Export" }]);
  });
});
