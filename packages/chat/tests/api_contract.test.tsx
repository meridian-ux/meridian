// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as rootApi from "../src/index.js";
import * as webApi from "../src/web.js";
import * as browserApi from "../src/browser.js";
import devManifest from "../package.json";
import publishManifest from "../chat.package.json";

const scroll = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  vi.stubGlobal("EventSource", class { close() {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollTo = vi.fn();
  webApi.registerAssistantPanel();
});
afterEach(() => {
  document.body.replaceChildren();
  HTMLElement.prototype.scrollTo = scroll;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("pins runtime exports of each distinct public tier", () => {
  expect(Object.keys(rootApi).sort()).toEqual([
    "BlockView", "CONVERSATION_CSS", "Conversation", "ConversationModel", "isActiveStatus",
  ].sort());
  expect(Object.keys(webApi).sort()).toEqual([
    "ASSISTANT_PANEL_CSS", "MAssistantPanel", "registerAssistantPanel",
    "renderBlockInner", "escHtml", "mdInline", "shortName", "ConversationModel", "isActiveStatus",
  ].sort());
  expect(Object.keys(browserApi).sort()).toEqual([
    "ASSISTANT_PANEL_CSS", "MAssistantPanel", "registerAssistantPanel",
  ].sort());
  expect(webApi.ConversationModel).toBe(rootApi.ConversationModel);
  expect(browserApi.MAssistantPanel).toBe(webApi.MAssistantPanel);
});

it("publishes only the reviewed ESM entrypoints with matching declarations", () => {
  for (const manifest of [devManifest, publishManifest]) {
    expect(manifest.exports).toEqual({
      ".": { types: "./src/index.d.ts", import: "./src/index.js" },
      "./web": { types: "./src/web.d.ts", import: "./src/web.js" },
    });
    expect(manifest.peerDependenciesMeta.react.optional).toBe(true);
    expect(manifest.peerDependenciesMeta["react-dom"].optional).toBe(true);
  }
});

it("submit emits a bubbling noncancelable intent before POST, not an acknowledgment", async () => {
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  const order: string[] = [];
  const fetch = vi.fn(() => { order.push("post"); return pending; });
  vi.stubGlobal("fetch", fetch);
  const panel = document.createElement("m-assistant-panel") as webApi.MAssistantPanel;
  const events: CustomEvent[] = [];
  const host = document.createElement("main");
  host.addEventListener("turn-sent", event => {
    order.push("intent");
    events.push(event as CustomEvent);
  });
  document.body.append(host);
  host.append(panel);
  panel.setAttribute("turn-url", "/conversation/turn");
  panel.submit("  Hello  ");
  expect(order).toEqual(["intent", "post"]);
  expect(events).toHaveLength(1);
  expect(events[0]!.detail).toEqual({ message: "Hello" });
  expect(events[0]!.bubbles).toBe(true);
  expect(events[0]!.cancelable).toBe(false);
  expect(events[0]!.composed).toBe(false);
  expect(fetch).toHaveBeenCalledWith("/conversation/turn", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello" }),
  });
  expect(panel.querySelector("input")!.value).toBe("");
  expect(panel.querySelector("button")!.disabled).toBe(true);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  complete(new Response("failed", { status: 503 }));
  await vi.waitFor(() => expect(panel.querySelector("button")!.disabled).toBe(false));
  expect(error).toHaveBeenCalled();
  expect(events).toHaveLength(1);
  panel.submit(" \n ");
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([false, true])("initialMessage posts at most once in StrictMode (present on mount=%s)", async present => {
  const fetch = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("main");
  document.body.append(host);
  const root = createRoot(host);
  const view = (initialMessage?: string, turnUrl = "/turn") => createElement(StrictMode, {},
    createElement(rootApi.Conversation, { initialMessage, turnUrl }));
  try {
    await act(async () => root.render(view(present ? "  First  " : undefined)));
    if (!present) {
      expect(fetch).not.toHaveBeenCalled();
      await act(async () => root.render(view("  First  ")));
    }
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual(["/turn", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "First" }),
    }]);
    await act(async () => root.render(view("Replacement", "/replacement")));
    expect(fetch).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); }
});

it("a whitespace-only initialMessage consumes its one-shot attempt without POSTing", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("main");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(rootApi.Conversation, { initialMessage: " \n " })));
    await act(async () => root.render(createElement(rootApi.Conversation, { initialMessage: "Later" })));
    expect(fetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
