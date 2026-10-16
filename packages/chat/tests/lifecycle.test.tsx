// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { create, toJson } from "@bufbuild/protobuf";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Conversation, ConversationModel } from "../src/index.js";
import { MAssistantPanel, registerAssistantPanel } from "../src/web.js";

class Source {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  close = vi.fn();
  constructor(readonly url: string) { sources.push(this); }
}
let sources: Source[] = [];
const scroll = HTMLElement.prototype.scrollTo;
beforeEach(() => {
  sources = [];
  vi.stubGlobal("EventSource", Source);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollTo = vi.fn();
  registerAssistantPanel();
});
afterEach(() => {
  document.body.replaceChildren();
  HTMLElement.prototype.scrollTo = scroll;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function emit(source: Source, seq: bigint, text: string) {
  const event = create(ConversationEventSchema, { seq, event: { case: "block", value: {
    blockId: "progress", kind: { case: "markdown", value: { text } },
  } } });
  source.onmessage!(new MessageEvent("message", { data: JSON.stringify(toJson(ConversationEventSchema, event)) }));
}
function panel() {
  const element = document.createElement("m-assistant-panel");
  document.body.append(element);
  return element;
}
it("reconnecting the same component retains rows, drafts and replay identities", () => {
  const element = panel();
  emit(sources[0]!, 1n, "First");
  const input = element.querySelector("input")!;
  input.value = "Unsent draft";
  element.remove();
  expect(sources[0]!.close).toHaveBeenCalledOnce();
  emit(sources[0]!, 2n, "Disconnected stale frame");
  expect(element.querySelector(".asst-row")?.textContent).toBe("First");
  document.body.append(element);
  expect(element.querySelector(".asst-row")?.textContent).toBe("First");
  expect(element.querySelector("input")).toBe(input);
  expect(input.value).toBe("Unsent draft");
  emit(sources[1]!, 1n, "Replay");
  expect(element.querySelector(".asst-row")?.textContent).toBe("First");
  emit(sources[1]!, 2n, "Updated");
  expect(element.querySelectorAll(".asst-row")).toHaveLength(1);
  expect(element.querySelector(".asst-row")?.textContent).toBe("Updated");
  expect(fetch).not.toHaveBeenCalled();
});
it("superseded web streams cannot update rows or poison current sequence IDs", () => {
  const element = panel();
  emit(sources[0]!, 1n, "Initial");
  element.setAttribute("sse-url", "/replacement");
  expect(sources[0]!.close).toHaveBeenCalledOnce();
  expect(sources[1]!.url).toBe("/replacement");
  emit(sources[0]!, 2n, "Stale");
  expect(element.querySelector(".asst-row")?.textContent).toBe("Initial");
  emit(sources[1]!, 2n, "Current");
  expect(element.querySelector(".asst-row")?.textContent).toBe("Current");
});
it("upgrading an already-connected element opens only one stream", () => {
  const element = document.createElement("m-chat-upgrade-fixture");
  element.setAttribute("sse-url", "/upgrade");
  document.body.append(element);
  customElements.define("m-chat-upgrade-fixture", class extends MAssistantPanel {});
  expect(sources).toHaveLength(1);
  expect(sources[0]!.url).toBe("/upgrade");
  element.remove();
  expect(sources[0]!.close).toHaveBeenCalledOnce();
});
it("React retains mounted state, ignores replaced streams and closes on unmount", async () => {
  const ingest = vi.spyOn(ConversationModel.prototype, "ingest");
  const host = document.createElement("main");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Conversation, { sseUrl: "/first" })));
    await act(async () => emit(sources[0]!, 1n, "Initial"));
    await act(async () => root.render(createElement(Conversation, { sseUrl: "/replacement" })));
    expect(sources[0]!.close).toHaveBeenCalledOnce();
    expect(host.querySelector(".asst-row")?.textContent).toBe("Initial");
    await act(async () => emit(sources[0]!, 2n, "Stale"));
    expect(host.querySelector(".asst-row")?.textContent).toBe("Initial");
    await act(async () => emit(sources[1]!, 2n, "Current"));
    expect(host.querySelector(".asst-row")?.textContent).toBe("Current");
    expect(fetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
  expect(sources[1]!.close).toHaveBeenCalledOnce();
  expect(ingest).toHaveBeenCalled();
  const count = ingest.mock.calls.length;
  await act(async () => emit(sources[1]!, 3n, "Unmounted stale frame"));
  expect(ingest.mock.calls).toHaveLength(count);
});
