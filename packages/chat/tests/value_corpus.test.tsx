// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { BlockSchema, ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONVERSATION_VALUES, conversationValueBlocks } from "../../../schemas/conformance/conversation_values.js";
import { renderBlockInner } from "../src/render_html.js";
import { BlockView } from "../src/render_react.js";
import type { Block } from "../src/wire.js";
import { registerAssistantPanel } from "../src/web.js";

class Source {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  close = vi.fn();
  constructor() { sources.push(this); }
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

it("covers every declared ValueType on string-valued conversation slots", () => {
  expect(CONVERSATION_VALUES).toHaveLength(206);
  expect(new Set(CONVERSATION_VALUES.map(entry => entry.name)).size).toBe(206);
  const declared = Object.values(ValueType).filter(value => typeof value === "number" && value !== 0);
  expect(new Set(CONVERSATION_VALUES.filter(entry => declared.includes(entry.type)).map(entry => entry.type)))
    .toEqual(new Set(declared));
});

it.each(CONVERSATION_VALUES)("standalone assistant SSE option contract: $name", entry => {
  for (const enumAsInteger of [false, true]) {
    const panel = document.createElement("m-assistant-panel");
    document.body.append(panel);
    const source = sources.at(-1)!;
    let seq = 0n;
    for (const message of conversationValueBlocks(entry)) {
      const block = create(BlockSchema, { ...message, blockId: "value" });
      const bytes = toBinary(BlockSchema, block);
      const event = create(ConversationEventSchema, { seq: ++seq,
        event: { case: "block", value: fromBinary(BlockSchema, bytes) } });
      source.onmessage!(new MessageEvent("message", {
        data: JSON.stringify(toJson(ConversationEventSchema, event, { enumAsInteger })),
      }));
      const selector = block.kind.case === "fields" ? ".fields > div:not(.k)"
        : block.kind.case === "table" ? "td" : ".ltitle, .lsub";
      const slots = block.kind.case === "list" && entry.raw ? 2 : 1;
      expect([...panel.querySelectorAll(selector)].map(node => node.textContent))
        .toEqual(Array(slots).fill(entry.expected));
      if (entry.expectedTitle !== undefined) {
        expect([...panel.querySelectorAll("[title]")].filter(node => node.getAttribute("title") === entry.expectedTitle))
          .toHaveLength(slots);
      }
      expect(panel.querySelectorAll(".asst-row")).toHaveLength(1);
      expect(panel.querySelector(".asst-row a")).toBeNull();
      expect(panel.textContent).not.toContain("stale legacy cell");
      expect(toBinary(BlockSchema, block)).toEqual(bytes);
    }
    panel.remove();
    expect(source.close).toHaveBeenCalledOnce();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it.each(CONVERSATION_VALUES)("HTML/React conversation string contract: $name", entry => {
  for (const message of conversationValueBlocks(entry)) {
    const bytes = toBinary(BlockSchema, message);
    const decoded = fromBinary(BlockSchema, bytes);
    for (const enumAsInteger of [false, true]) {
      const block = toJson(BlockSchema, decoded, { enumAsInteger }) as unknown as Block;
      for (const html of [renderBlockInner(block), renderToStaticMarkup(createElement(BlockView, { block }))]) {
        const root = document.createElement("main");
        root.innerHTML = html;
        const selector = block.fields ? ".fields > div:not(.k)" : block.table ? "td" : ".ltitle, .lsub";
        const values = [...root.querySelectorAll(selector)].map(node => node.textContent);
        expect(values[0]).toBe(entry.expected);
        if (block.list && entry.raw) {
          expect(values).toHaveLength(2);
          // The React tier puts its one separating space inside the subtitle
          // span; HTML puts it outside. Do not trim authored value whitespace.
          expect([entry.expected, ` ${entry.expected}`]).toContain(values[1]);
        } else expect(values).toHaveLength(1);
        expect(root.querySelector("a")).toBeNull();
        expect(root.textContent).not.toContain("stale legacy cell");
        if (entry.expectedTitle !== undefined) {
          expect([...root.querySelectorAll("[title]")].filter(node => node.getAttribute("title") === entry.expectedTitle))
            .toHaveLength(block.list && entry.raw ? 2 : 1);
        }
      }
    }
    expect(toBinary(BlockSchema, decoded)).toEqual(bytes);
  }
});
