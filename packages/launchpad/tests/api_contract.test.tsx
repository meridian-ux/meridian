// @vitest-environment jsdom
import { createElement } from "react";
import { create } from "@bufbuild/protobuf";
import { CommandSchema, LaunchpadSchema, type Command } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function mount(command: Command, callbacks: Partial<api.LaunchpadProps>, invoke = vi.fn(async () => ({}))) {
  const descriptor = create(LaunchpadSchema, { groups: [{ id: "commands", commands: [command] }] });
  render(createElement(MeridianProvider, { invoker: { invoke }, kit: htmlKit, adhoc: {}, children:
    createElement(api.Launchpad, { descriptor, open: true, onClose: () => {}, ...callbacks }) }));
  return invoke;
}

it("notifies navigation, close, then onRun with the original canonical command", () => {
  const order: string[] = [];
  const command = create(CommandSchema, { id: "nav", title: "Navigate", action: {
    case: "navigate", value: { route: " /builds " },
  } });
  const onRun = vi.fn(value => { expect(value).toBe(command); order.push("run"); });
  mount(command, {
    onNavigate: route => { expect(route).toBe("/builds"); order.push("navigate"); },
    onClose: () => { order.push("close"); }, onRun,
  });
  fireEvent.mouseDown(screen.getByRole("option"));
  expect(order).toEqual(["navigate", "close", "run"]);
  expect(onRun).toHaveBeenCalledOnce();
});

it("onRun is a dispatch notification even when default mutation admission denies RPC", async () => {
  const command = create(CommandSchema, { id: "rpc", title: "Export", action: {
    case: "rpc", value: { service: "acme.v1.Exporter", method: "Export" },
  } });
  const onRun = vi.fn();
  const onClose = vi.fn();
  const invoke = mount(command, { onRun, onClose });
  fireEvent.mouseDown(screen.getByRole("option"));
  expect(onRun).toHaveBeenCalledWith(command);
  expect(onClose).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(invoke).not.toHaveBeenCalled();
});

it("blocked navigation emits neither dispatch notification nor close", () => {
  const command = create(CommandSchema, { id: "unsafe", title: "Unsafe", action: {
    case: "navigate", value: { route: "javascript:alert(1)" },
  } });
  const onRun = vi.fn();
  const onClose = vi.fn();
  mount(command, { onRun, onClose });
  fireEvent.mouseDown(screen.getByRole("option"));
  expect(onRun).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("open-view uses the host callback and then closes/notifies", () => {
  const command = create(CommandSchema, { id: "view", title: "Open view", action: {
    case: "openViewId", value: "views/builds",
  } });
  const order: string[] = [];
  mount(command, {
    onOpenView: id => { expect(id).toBe("views/builds"); order.push("view"); },
    onClose: () => { order.push("close"); },
    onRun: value => { expect(value).toBe(command); order.push("run"); },
  });
  fireEvent.mouseDown(screen.getByRole("option"));
  expect(order).toEqual(["view", "close", "run"]);
});

it("open-panel notifies after focusing without closing the palette", () => {
  const command = create(CommandSchema, { id: "panel", title: "Open panel", action: {
    case: "openPanel", value: { panel: { panelId: "focused", title: "Details" } },
  } });
  const onClose = vi.fn();
  const onRun = vi.fn();
  mount(command, { onClose, onRun });
  fireEvent.mouseDown(screen.getByRole("option"));
  expect(screen.getByRole("button", { name: /Back/ })).toBeDefined();
  expect(onClose).not.toHaveBeenCalled();
  expect(onRun).toHaveBeenCalledWith(command);
});
