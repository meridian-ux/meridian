// @vitest-environment jsdom
import { createElement } from "react";
import { create } from "@bufbuild/protobuf";
import { CommandSchema, LaunchpadSchema, type Command } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { safeNavigationHref, type InvocationHost } from "@savvifi/meridian-schemas/uiview";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../src/index.js";
import devManifest from "../package.json";
import publishManifest from "../launchpad.package.json";

afterEach(cleanup);
it("pins the runtime exports independently of type-only exports", () => {
  expect(Object.keys(api).sort()).toEqual([
    "Launchpad", "filterLaunchpad", "flatten", "matchScore", "commandHaystack",
  ].sort());
});

it("publishes the reviewed root ESM entrypoint and compatible schema/renderer peers", () => {
  for (const manifest of [devManifest, publishManifest]) {
    expect(manifest.exports).toEqual({
      ".": { types: "./src/index.d.ts", import: "./src/index.js" },
    });
    for (const peer of ["react", "react-dom", "@savvifi/meridian-web-react", "@savvifi/meridian-proto-ts"] as const) {
      expect(manifest.peerDependencies[peer]).toBeTruthy();
    }
  }
});

function mount(command: Command, callbacks: Partial<api.LaunchpadProps>, invoke = vi.fn(async () => ({})), extra: InvocationHost["capabilities"] = {}) {
  const descriptor = create(LaunchpadSchema, { groups: [{ id: "commands", commands: [command] }] });
  render(createElement(MeridianProvider, { invoker: { invoke }, kit: htmlKit, adhoc: {}, invocation: { admit: () => true, capabilities: {
    navigate: async target => { callbacks.onNavigate?.(safeNavigationHref(target.route)!); },
    openView: async view => { callbacks.onOpenView?.(view); }, ...extra,
  } }, children:
    createElement(api.Launchpad, { descriptor, open: true, onClose: () => {}, ...callbacks }) }));
  return invoke;
}

it("notifies admitted navigation, close, then success-only onRun with the original command", async () => {
  const order: string[] = [];
  const command = create(CommandSchema, { id: "nav", title: "Navigate", affordance: { label: "Navigate", invoke: {
    case: "navigate", value: { route: " /builds " },
  } } });
  const onRun = vi.fn(value => { expect(value).toBe(command); order.push("run"); });
  mount(command, {
    onNavigate: route => { expect(route).toBe("/builds"); order.push("navigate"); },
    onClose: () => { order.push("close"); }, onRun,
  });
  fireEvent.click(screen.getByRole("option"));
  await waitFor(() => expect(order).toEqual(["navigate", "close", "run"]));
  expect(onRun).toHaveBeenCalledOnce();
});

it("denied RPC stays visible without success notification or close", async () => {
  const command = create(CommandSchema, { id: "rpc", title: "Export", affordance: { label: "Export", invoke: {
    case: "rpc", value: { service: "acme.v1.Exporter", method: "Export" },
  } } });
  const onRun = vi.fn();
  const onClose = vi.fn();
  const invoke = mount(command, { onRun, onClose });
  fireEvent.click(screen.getByRole("option"));
  expect((await screen.findByRole("alert")).textContent).toContain("mutation policy");
  expect(onRun).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it("blocked navigation emits neither dispatch notification nor close", () => {
  const command = create(CommandSchema, { id: "unsafe", title: "Unsafe", affordance: { label: "Unsafe", invoke: {
    case: "navigate", value: { route: "javascript:alert(1)" },
  } } });
  const onRun = vi.fn();
  const onClose = vi.fn();
  mount(command, { onRun, onClose });
  fireEvent.click(screen.getByRole("option"));
  expect(onRun).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("open-view uses the explicit host capability and then closes/notifies", async () => {
  const command = create(CommandSchema, { id: "view", title: "Open view", affordance: { label: "Open view", invoke: {
    case: "openView", value: "views/builds",
  } } });
  const order: string[] = [];
  mount(command, {
    onOpenView: id => { expect(id).toBe("views/builds"); order.push("view"); },
    onClose: () => { order.push("close"); },
    onRun: value => { expect(value).toBe(command); order.push("run"); },
  });
  fireEvent.click(screen.getByRole("option"));
  await waitFor(() => expect(order).toEqual(["view", "close", "run"]));
});

it("open-panel requires explicit host capability; never implicitly mounts descriptor content", async () => {
  const command = create(CommandSchema, { id: "panel", title: "Open panel", affordance: { label: "Open panel", invoke: {
    case: "openPanel", value: { panelId: "focused", title: "Details" },
  } } });
  const onClose = vi.fn();
  const onRun = vi.fn();
  const openPanel = vi.fn(async () => {});
  mount(command, { onClose, onRun }, undefined, { openPanel });
  fireEvent.click(screen.getByRole("option"));
  await waitFor(() => expect(onRun).toHaveBeenCalledWith(command));
  expect(openPanel).toHaveBeenCalledWith(expect.objectContaining({ panelId: "focused" }), expect.any(Object), expect.any(AbortSignal));
  expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  expect(onClose).toHaveBeenCalledOnce();
});
