import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { renderBlockInner } from "../src/render_html.js";
import { BlockView, Conversation } from "../src/index.js";
import type { Block } from "../src/wire.js";
import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { BlockSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { PrincipalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";

describe("conversation list displays", () => {
  const renderers = [renderBlockInner, (block: Block) => renderToStaticMarkup(createElement(BlockView, { block }))];
  it("formats protobuf list slots without changing raw values", () => {
    const message = create(BlockSchema, { kind: { case: "list", value: { items: [{
      title: "2026-03-29T00:00:00Z", titleDisplay: { type: ValueType.DATE },
      subtitle: "Ada <ada@example.com>", subtitleDisplay: { type: ValueType.PRINCIPAL,
        options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } },
      badges: ["<safe>"],
    }] } } });
    const bytes = toBinary(BlockSchema, message);
    const decoded = fromBinary(BlockSchema, bytes);
    for (const enumAsInteger of [true, false]) {
      const wire = toJson(BlockSchema, decoded, { enumAsInteger }) as unknown as Block;
      for (const render of renderers) {
        const html = render(wire);
        expect(html).toContain("Mar 29, 2026");
        expect(html).toContain('title="ada@example.com"');
        expect(html).toContain("Ada</span>");
        expect(html).toContain("&lt;safe&gt;");
      }
    }
    expect(toBinary(BlockSchema, decoded)).toEqual(bytes);
  });
  it("preserves literal strings for absent, unsupported, and malformed declarations", () => {
    for (const display of [undefined, {}, { type: 999 }, { type: "FUTURE" },
      { type: "DATE", temporal: { precision: [] } }, { type: ValueType.DECIMAL }]) {
      for (const render of renderers) {
        const html = render({ list: { items: [{ title: "0012.50", subtitle: "<literal>", titleDisplay: display, subtitleDisplay: display }] } });
        expect(html).toContain("0012.50</span>");
        expect(html).toContain("&lt;literal&gt;</span>");
      }
    }
  });
});

describe("conversation field displays", () => {
  const renderers = [renderBlockInner, (block: Block) => renderToStaticMarkup(createElement(BlockView, { block }))];

  it("formats wire-decoded temporal and principal strings in both web tiers", () => {
    const message = create(BlockSchema, { kind: { case: "fields", value: { fields: [
      { key: "Due", value: "2026-03-29T00:00:00Z", display: { type: ValueType.DATE } },
      { key: "Owner", value: 'Ada <ada@example.com>', display: { type: ValueType.PRINCIPAL,
        options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
      { key: "Literal", value: "2026-03-29T00:00:00Z" },
      { key: "Text", value: "2026-03-29T00:00:00Z", display: { type: ValueType.TEXT } },
      { key: "Count", value: "0012.50", display: { type: ValueType.DECIMAL,
        options: { case: "number", value: { fractionDigits: 0 } } } },
      { key: "Boolean", value: "false", display: { type: ValueType.BOOLEAN } },
    ] } } });
    const decoded = fromBinary(BlockSchema, toBinary(BlockSchema, message));
    for (const enumAsInteger of [false, true]) {
      const wire = toJson(BlockSchema, decoded, { enumAsInteger }) as unknown as Block;
      for (const render of renderers) {
        const html = render(wire);
        expect(html).toContain("Mar 29, 2026");
        expect(html).toContain('title="ada@example.com">Ada</div>');
        expect(html.match(/2026-03-29T00:00:00Z/g)).toHaveLength(2);
        expect(html).toContain("0012.50");
        expect(html).toContain(">false</div>");
      }
    }
  });

  it("keeps absent, unspecified, unknown and malformed displays compatible", () => {
    for (const display of [undefined, {}, { type: 0 }, { type: 999 }, { type: "FUTURE_TYPE" },
      { type: "DATE", temporal: { precision: [] } }]) {
      const block: Block = { fields: { fields: [{ key: "Raw", value: '2026-03-29T00:00:00Z', display }] } };
      for (const render of renderers) expect(render(block)).toContain(">2026-03-29T00:00:00Z</div>");
    }
  });

  it("escapes values and email titles and never creates navigation from display metadata", () => {
    const block: Block = { fields: { fields: [
      { key: "Owner", value: 'Ada <a" onclick="evil@example.com>', display: {
        type: "PRINCIPAL", principal: { display: "NAME_WITH_EMAIL_TITLE" } } },
      { key: "URL", value: "javascript:alert(1)", display: { type: "URL", link: { targetKind: "user" } } },
      { key: "Empty", value: "", display: { type: "DATE" } },
      { key: "HTML", value: "<script>bad</script>", display: { type: "TEXT" } },
    ] } };
    for (const render of renderers) {
      const html = render(block);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain(' onclick="evil');
      expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
      expect(html).toContain('class="k">Empty</div><div></div>');
    }
  });
});

describe("conversation table cell displays", () => {
  const renderers = [renderBlockInner, (block: Block) => renderToStaticMarkup(createElement(BlockView, { block }))];

  it("round-trips rich cells, preserves raw values, and falls back per key", () => {
    const message = create(BlockSchema, { kind: { case: "table", value: {
      columns: ["due", "owner", "legacy", "empty", "count"].map(key => ({ key })),
      rows: [{ cells: { due: "old", legacy: "<raw>", empty: "old" }, displayCells: {
        due: { value: "2026-03-29T00:00:00Z", display: { type: ValueType.DATE } },
        owner: { value: "Ada <ada@example.com>", display: { type: ValueType.PRINCIPAL,
          options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
        empty: {}, count: { value: "0012.50", display: { type: ValueType.DECIMAL } },
      } }],
    } } });
    const decoded = fromBinary(BlockSchema, toBinary(BlockSchema, message));
    for (const enumAsInteger of [false, true]) {
      const wire = toJson(BlockSchema, decoded, { enumAsInteger }) as unknown as Block;
      for (const render of renderers) {
        const html = render(wire);
        expect(html).toContain("Mar 29, 2026");
        expect(html).toContain('title="ada@example.com">Ada</td>');
        expect(html).toContain("&lt;raw&gt;</td><td></td><td>0012.50</td>");
        expect(html).not.toContain("old");
      }
      expect(wire.table?.rows?.[0].displayCells?.due.value).toBe("2026-03-29T00:00:00Z");
    }
  });

  it("preserves absent, unknown, malformed and unsupported display values", () => {
    for (const display of [undefined, {}, { type: 999 }, { type: "FUTURE_TYPE" },
      { type: "DATE", temporal: { precision: [] } }, { type: "URL" }]) {
      const block: Block = { table: { columns: [{ key: "v" }], rows: [{
        displayCells: { v: { value: "<raw>", display } },
      }] } };
      for (const render of renderers) expect(render(block)).toContain("<td>&lt;raw&gt;</td>");
    }
  });
});

describe("renderBlockInner (vanilla HTML)", () => {
  it("renders a tool block with an ok dot + summary", () => {
    const b: Block = {
      blockId: "t",
      role: "assistant",
      tool: { name: "forge·list", state: "OK", summary: "3 repos" },
    };
    const html = renderBlockInner(b);
    expect(html).toContain("forge·list");
    expect(html).toContain("dot ok");
    expect(html).toContain("3 repos");
  });

  it("escapes markdown text and applies **bold**", () => {
    const html = renderBlockInner({ blockId: "m", markdown: { text: "a <b> **x**" } });
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("<strong>x</strong>");
  });

  it("renders a table block", () => {
    const html = renderBlockInner({
      blockId: "tb",
      table: {
        title: "Repos",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ cells: { name: "example/web" } }],
      },
    });
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("example/web");
  });
});

describe("<Conversation> (react)", () => {
  it("renders the wrapper, empty state, and composer", () => {
    // createElement (not JSX) so the test runs under both the pnpm (automatic
    // JSX runtime) and Bazel/rules_vite (classic runtime) harnesses.
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).toContain("meridian-conversation");
    expect(html).toContain("asst-input");
    expect(html).toContain("connected tools");
  });
});

describe("view blocks", () => {
  const descriptor = { id: "demo", title: "Demo", layout: { stacked: {} }, slots: [] };
  const viewBlock: Block = { blockId: "b1", role: "assistant", view: descriptor };

  // createElement (not JSX), matching the rest of this file — see the note above.
  it("delegates a view block to the host renderer, with the block alongside", () => {
    const seen: unknown[] = [];
    const html = renderToStaticMarkup(
      createElement(BlockView, {
        block: viewBlock,
        renderView: (view, block) => {
          seen.push([view, block.blockId]);
          return createElement("div", { className: "host-view" }, "drawn");
        },
      }),
    );
    expect(html).toContain("host-view");
    expect(seen).toEqual([[descriptor, "b1"]]);
  });

  // The point of the seam: a host that has NOT opted in is unaffected by an agent
  // emitting a view. It renders as nothing, exactly like any unknown block kind —
  // so shipping this arm cannot break an existing consumer.
  it("renders nothing when the host supplies no renderer", () => {
    expect(renderToStaticMarkup(createElement(BlockView, { block: viewBlock }))).toBe("");
  });

  it("does not call the host renderer for non-view blocks", () => {
    let called = false;
    renderToStaticMarkup(
      createElement(BlockView, {
        block: { blockId: "b1", role: "assistant", markdown: { text: "hi" } },
        renderView: () => {
          called = true;
          return null;
        },
      }),
    );
    expect(called).toBe(false);
  });
});
