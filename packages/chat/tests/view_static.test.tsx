// @vitest-environment jsdom
import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { BlockSchema, ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LAYOUT_CASES } from "../../../schemas/conformance/layout_cases.js";
import { STATE_CASES } from "../../../schemas/conformance/state_cases.js";
import { staticViewText } from "@savvifi/meridian-schemas/uiview";
import { renderBlockInner } from "../src/render_html.js";
import { BlockView } from "../src/render_react.js";
import { Conversation } from "../src/conversation.js";
import { viewText } from "../src/view_text.js";
import type { Block } from "../src/wire.js";

const renderers = [renderBlockInner, (block: Block) => renderToStaticMarkup(createElement(BlockView, { block }))];
describe("passive conversation view realization over the shared binary corpus", () => {
  it.each(STATE_CASES)("panel projection: $name", fixture => {
    const wire = toJson(ViewDescriptorSchema, fixture.view);
    const expected = staticViewText(toBinary(ViewDescriptorSchema, fixture.view));
    expect(expected).toContain(fixture.view.title);
    expect(expected).toContain(fixture.view.slots[0].panel!.title);
    expect(expected).not.toContain("Unsupported or unset panel shape");
    if (fixture.input?.masked) expect(expected).not.toContain(String(fixture.input.raw));
    for (const render of renderers) {
      const container = document.createElement("div"); container.innerHTML = render({ view: wire as Record<string, unknown> });
      expect(container.querySelector("pre")?.textContent).toBe(expected);
      expect(container.querySelector("button,a,script,iframe,form")).toBeNull();
    }
  });
  it.each(LAYOUT_CASES)("$name", fixture => {
    const message = create(BlockSchema, { blockId: fixture.name, kind: { case: "view", value: fixture.view } });
    const decoded = fromBinary(BlockSchema, toBinary(BlockSchema, message));
    const wire = toJson(BlockSchema, decoded) as unknown as Block;
    const expected = staticViewText(toBinary(ViewDescriptorSchema, fixture.view));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      for (const render of renderers) {
        const container = document.createElement("div"); container.innerHTML = render(wire);
        expect(container.querySelector("pre")?.textContent).toBe(expected);
        expect(container.querySelector("button,a,script,iframe,form")).toBeNull();
        let cursor = 0;
        for (const id of fixture.staticOrder) {
          const label = `Section: Section ${id}`;
          const next = expected.indexOf(label, cursor); expect(next).toBeGreaterThanOrEqual(cursor);
          cursor = next + label.length;
        }
        for (const text of fixture.staticContent) expect(expected).toContain(text);
        if (fixture.name.startsWith("gate-")) expect(expected).not.toContain("Fetched scoped");
        if (fixture.name === "repeated") { expect(expected).not.toContain("001.20"); expect(expected).not.toContain("Second row"); }
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("preserves markup as text and rejects malformed/cyclic/accessor data without echoing it", () => {
    const valid = { id: "<script>alert(1)</script>", title: "<img onerror=bad>" };
    for (const render of renderers) {
      const container = document.createElement("div"); container.innerHTML = render({ view: valid });
      expect(container.querySelector("script,img")).toBeNull(); expect(container.textContent).toContain("<img onerror=bad>");
    }
    const getter = vi.fn(() => { throw new Error("do not echo"); });
    const accessor = Object.defineProperty({}, "title", { enumerable: true, get: getter });
    const cycle: Record<string, unknown> = {}; cycle.slots = [cycle];
    for (const value of [accessor, cycle, { title: "x".repeat(5 * 1024 * 1024) }, { slots: "bad" }, { title: NaN }]) {
      expect(viewText(value)).toBe("View content unavailable: malformed or oversized static composition.");
    }
    expect(getter).not.toHaveBeenCalled();
    const propertyGet = vi.fn(() => { throw new Error("get trap must not run"); });
    const slots = new Proxy([], { get: propertyGet });
    expect(viewText({ id: "safe", slots })).toContain("No sections."); expect(propertyGet).not.toHaveBeenCalled();
  });

  it("renders canonical streamed view updates through Conversation without a host renderer or extra transport", async () => {
    class Source {
      static current: Source;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      constructor() { Source.current = this; }
      close() {}
    }
    vi.stubGlobal("EventSource", Source); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const previousScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const container = document.createElement("div"), root = createRoot(container);
    const event = (title: string, seq: bigint) => JSON.stringify(toJson(ConversationEventSchema, create(ConversationEventSchema, {
      seq, event: { case: "block", value: { blockId: "view", kind: { case: "view", value: { id: "view", title, slots: [] } } } },
    })));
    try {
      await act(async () => root.render(createElement(Conversation, {})));
      await act(async () => Source.current.onmessage!(new MessageEvent("message", { data: event("Original view", 1n) })));
      expect(container.textContent).toContain("Original view");
      await act(async () => Source.current.onmessage!(new MessageEvent("message", { data: event("Updated view", 2n) })));
      expect(container.textContent).toContain("Updated view"); expect(container.textContent).not.toContain("Original view");
      expect(container.querySelectorAll("pre.view-static")).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      if (previousScroll) Object.defineProperty(HTMLElement.prototype, "scrollTo", previousScroll);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
      vi.unstubAllGlobals();
    }
  });
});
