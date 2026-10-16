// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { BlockSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { expect, it } from "vitest";
import { CONVERSATION_VALUES, conversationValueBlocks } from "../../../schemas/conformance/conversation_values.js";
import { renderBlockInner } from "../src/render_html.js";
import { BlockView } from "../src/render_react.js";
import type { Block } from "../src/wire.js";

it("covers every declared ValueType on string-valued conversation slots", () => {
  const declared = Object.values(ValueType).filter(value => typeof value === "number" && value !== 0);
  expect(new Set(CONVERSATION_VALUES.filter(entry => declared.includes(entry.type)).map(entry => entry.type)))
    .toEqual(new Set(declared));
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
      }
    }
    expect(toBinary(BlockSchema, decoded)).toEqual(bytes);
  }
});
