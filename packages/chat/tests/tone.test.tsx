// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { afterEach, expect, it, vi } from "vitest";
import { Conversation } from "../src/conversation.js";
import { registerAssistantPanel } from "../src/assistant_panel.js";
import { renderBlockInner } from "../src/render_html.js";
import type { Block } from "../src/wire.js";

const originalScroll = HTMLElement.prototype.scrollTo;
afterEach(() => { document.body.replaceChildren(); HTMLElement.prototype.scrollTo = originalScroll; vi.unstubAllGlobals(); });

it.each([undefined, 0, 1, 2, 3, 4, 5, 6, 999])("conversation Tone %s stays independent of state in both web tiers", async tone => {
  const sources: Array<{ onmessage: ((event: MessageEvent) => void) | null }> = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;
    constructor() { sources.push(this); }
    close() {}
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  HTMLElement.prototype.scrollTo = vi.fn();
  registerAssistantPanel();
  const vanilla = document.createElement("m-assistant-panel"), host = document.createElement("main");
  document.body.append(vanilla, host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Conversation)));
  let seq = 0n;
  const expected = tone === undefined ? null : ["neutral", "neutral", "info", "success", "warning", "danger", "accent"][tone] ?? "neutral";
  try {
    for (const enumAsInteger of [false, true]) {
      const event = create(ConversationEventSchema, { seq: ++seq, event: { case: "block", value: {
        blockId: "tone", kind: { case: "tool", value: { name: "Task", state: 2, tone } },
      } } });
      const decoded = fromBinary(ConversationEventSchema, toBinary(ConversationEventSchema, event));
      const json = toJson(ConversationEventSchema, decoded, { enumAsInteger });
      const emit = async (message: unknown) => act(async () => {
        for (const source of sources) source.onmessage!(new MessageEvent("message", { data: JSON.stringify(message) }));
      });
      await emit(json);
      const html = document.createElement("main");
      html.innerHTML = renderBlockInner((json as { block: Block }).block);
      for (const surface of [vanilla, host, html]) {
        expect(surface.querySelector(".tool.err")?.getAttribute("data-mer-tone")).toBe(expected);
        expect(surface.querySelector(".dot.err")).not.toBeNull();
        expect(surface.textContent).toContain("Task");
      }
      await emit(toJson(ConversationEventSchema, create(ConversationEventSchema, { seq: ++seq,
        event: { case: "status", value: { state: 3, detail: "Working", tone } },
      }), { enumAsInteger }));
      for (const surface of [vanilla, host]) {
        expect(surface.querySelector(".status.on")?.getAttribute("data-mer-tone")).toBe(expected);
        expect(surface.querySelector(".status.on")?.textContent).toBe("Working");
      }
      await emit(toJson(ConversationEventSchema, create(ConversationEventSchema, { seq: ++seq,
        event: { case: "status", value: { state: 1, tone: 5 } },
      }), { enumAsInteger }));
      for (const surface of [vanilla, host]) expect(surface.querySelector(".status.on")).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
