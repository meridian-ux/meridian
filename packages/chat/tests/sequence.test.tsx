// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { expect, it, vi } from "vitest";
import { Conversation } from "../src/conversation.js";
import { ConversationModel } from "../src/model.js";
import { registerAssistantPanel } from "../src/assistant_panel.js";
import type { ConversationEvent } from "../src/wire.js";

const sequences = [9007199254740992n, 9007199254740993n, 18446744073709551614n, 18446744073709551615n];
function frame(seq: bigint, text = String(seq)): ConversationEvent {
  const message = create(ConversationEventSchema, { seq, event: { case: "block", value: {
    blockId: "progress", kind: { case: "markdown", value: { text } },
  } } });
  return toJson(ConversationEventSchema, fromBinary(ConversationEventSchema, toBinary(ConversationEventSchema, message))) as unknown as ConversationEvent;
}

it("model keeps adjacent uint64 sequence IDs distinct and suppresses actual replays", () => {
  const model = new ConversationModel();
  for (const seq of sequences) {
    expect(model.ingest(frame(seq))).toBe(true);
    expect(model.blocks[0]?.markdown?.text).toBe(String(seq));
    expect(model.ingest(frame(seq, "replayed"))).toBe(false);
    expect(model.blocks[0]?.markdown?.text).toBe(String(seq));
  }
});

it("safe legacy numbers deduplicate with strings without invalid IDs poisoning valid events", () => {
  const model = new ConversationModel();
  expect(model.ingest({ ...frame(7n), seq: 7 })).toBe(true);
  expect(model.ingest(frame(7n, "replayed"))).toBe(false);
  expect(model.ingest({ ...frame(7n), seq: "0007" })).toBe(false);
  for (const seq of [Number.MAX_SAFE_INTEGER + 1, Infinity, -1, "18446744073709551616", ""]) {
    expect(model.ingest({ ...frame(8n), seq })).toBe(true);
  }
  expect(model.ingest(frame(9007199254740992n))).toBe(true);
  model.reset();
  expect(model.ingest(frame(7n))).toBe(true);
});

it("both conversation web tiers render every canonical uint64 update without replaying duplicates", async () => {
  const sources: Array<{ onmessage: ((event: MessageEvent) => void) | null }> = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;
    constructor() { sources.push(this); }
    close() {}
  });
  const scroll = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = vi.fn();
  registerAssistantPanel();
  const vanilla = document.createElement("m-assistant-panel"), host = document.createElement("main");
  document.body.append(vanilla, host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Conversation)));
    expect(sources).toHaveLength(2);
    const emit = async (event: ConversationEvent) => act(async () => {
      for (const source of sources) source.onmessage!(new MessageEvent("message", { data: JSON.stringify(event) }));
    });
    for (const seq of sequences) {
      await emit(frame(seq));
      for (const surface of [vanilla, host]) expect(surface.querySelector(".asst-row")?.textContent).toBe(String(seq));
      await emit(frame(seq, "replayed"));
      for (const surface of [vanilla, host]) expect(surface.querySelector(".asst-row")?.textContent).toBe(String(seq));
    }
  } finally {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    HTMLElement.prototype.scrollTo = scroll;
    vi.unstubAllGlobals();
  }
});
