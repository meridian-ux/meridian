// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { registerChatPanel } from "../src/chat_panel.js";

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it.each([
  { timestamp: "2026-03-29T13:45:07Z", bid: 1.25, label: "Mar 29, 2026, 1:45:07 PM UTC", bidLabel: "1.2500" },
  { timestamp: '<img src=x onerror="bad()">', bid: '<img src=x onerror="bad()">', label: '<img src=x onerror="bad()">', bidLabel: '<img src=x onerror="bad()">' },
])("legacy chat uses core labels and preserves escaping: $timestamp", async ({ timestamp, bid, label, bidLabel }) => {
  let source!: { onmessage: ((message: MessageEvent) => void) | null };
  vi.stubGlobal("EventSource", class {
    onmessage: ((message: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    constructor() { source = this; }
    close() {}
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () =>
    url.includes("bidders") ? { version: "test", bidders: [] } : [],
  })));
  registerChatPanel();
  const panel = document.createElement("m-chat-panel");
  document.body.append(panel);
  Object.assign(panel.querySelector("[data-turns]")!.parentElement!, { scrollTo: vi.fn() });
  source.onmessage!(new MessageEvent("message", { data: JSON.stringify({
    event_id: 1, round: 1, ts: timestamp, query: "Question", winner: "tool",
    bids: [{ tool: "tool", value: bid }], price: 0.5,
    outcome: { kind: "success", payload: "Done" }, delta: [],
  }) }));
  await vi.waitFor(() => expect(panel.querySelector(".chat-turn-head")?.textContent).toContain(label));
  expect(panel.textContent).toContain(bidLabel);
  expect(panel.textContent).toContain("0.5000");
  expect(panel.querySelectorAll("img")).toHaveLength(0);
});
