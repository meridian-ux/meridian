// @vitest-environment jsdom
import { create, toJson } from "@bufbuild/protobuf";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAssistantPanel, registerAssistantPanel } from "../src/assistant_panel.js";

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
  HTMLElement.prototype.scrollTo = vi.fn();
  registerAssistantPanel();
});
afterEach(() => {
  document.body.replaceChildren();
  HTMLElement.prototype.scrollTo = scroll;
  vi.unstubAllGlobals();
});
function emit(source: Source, seq: bigint, text: string) {
  const event = create(ConversationEventSchema, { seq, event: { case: "block", value: {
    blockId: "progress", kind: { case: "markdown", value: { text } },
  } } });
  source.onmessage!(new MessageEvent("message", { data: JSON.stringify(toJson(ConversationEventSchema, event)) }));
}
it("reconnect keeps visible rows/drafts and rejects replaced stream events", () => {
  const element = document.createElement("m-assistant-panel");
  document.body.append(element);
  emit(sources[0]!, 1n, "Initial");
  const input = element.querySelector("input")!;
  input.value = "Unsent draft";
  element.remove();
  expect(sources[0]!.close).toHaveBeenCalledOnce();
  emit(sources[0]!, 2n, "Disconnected stale frame");
  expect(element.querySelector(".asst-row")?.textContent).toBe("Initial");
  document.body.append(element);
  expect(element.querySelector(".asst-row")?.textContent).toBe("Initial");
  expect(element.querySelector("input")).toBe(input);
  expect(input.value).toBe("Unsent draft");
  emit(sources[1]!, 1n, "Replay");
  expect(element.querySelector(".asst-row")?.textContent).toBe("Initial");
  emit(sources[0]!, 2n, "Stale");
  expect(element.querySelector(".asst-row")?.textContent).toBe("Initial");
  emit(sources[1]!, 2n, "Current");
  expect(element.querySelector(".asst-row")?.textContent).toBe("Current");
  element.setAttribute("sse-url", "/replacement");
  expect(sources[1]!.close).toHaveBeenCalledOnce();
  emit(sources[1]!, 3n, "Stale replacement");
  emit(sources[2]!, 3n, "Replacement");
  expect(element.querySelector(".asst-row")?.textContent).toBe("Replacement");
  expect(fetch).not.toHaveBeenCalled();
});
it("upgrading an already-connected legacy element opens only one stream", () => {
  const element = document.createElement("m-web-upgrade-fixture");
  element.setAttribute("sse-url", "/upgrade");
  document.body.append(element);
  customElements.define("m-web-upgrade-fixture", class extends MAssistantPanel {});
  expect(sources).toHaveLength(1);
  expect(sources[0]!.url).toBe("/upgrade");
  element.remove();
  expect(sources[0]!.close).toHaveBeenCalledOnce();
});
