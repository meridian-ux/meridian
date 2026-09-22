// @vitest-environment jsdom

import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import { ValueDisplaySchema, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { formatByDisplay } from "@savvifi/meridian-schemas/uiview";
import { describe, expect, it } from "vitest";

import { registerAssistantPanel } from "../src/assistant_panel.js";

function renderBlock(block: Record<string, unknown>): string {
  registerAssistantPanel();
  const panel = document.createElement("m-assistant-panel") as HTMLElement;
  const internals = panel as unknown as {
    render(): void;
    handle(event: unknown): void;
  };
  internals.render();
  Object.defineProperty(panel.querySelector("[data-log]"), "scrollTo", { value: () => undefined });
  internals.handle({
    seq: 1,
    block: { blockId: "test", ...block },
  });
  return panel.querySelector(".asst-row")?.innerHTML ?? "";
}

function renderListItem(item: Record<string, unknown>): string {
  return renderBlock({ list: { items: [item] } });
}

describe("vanilla assistant list displays", () => {
  it("formats supported wire-level date and principal declarations", () => {
    const decoded = fromJson(ValueDisplaySchema, { type: "VALUE_TYPE_DATE" });
    expect(decoded.type).toBe(ValueType.DATE);
    expect(formatByDisplay("2026-03-29T00:00:00Z", decoded).text).toBe("Mar 29, 2026");
    const html = renderListItem({
      title: "2026-03-29T00:00:00Z",
      titleDisplay: { type: "VALUE_TYPE_DATE" },
      subtitle: "Ada <ada@example.com>",
      subtitleDisplay: {
        type: "VALUE_TYPE_PRINCIPAL",
        principal: { display: "PRINCIPAL_DISPLAY_NAME_WITH_EMAIL_TITLE" },
      },
    });

    expect(html).toContain("Mar 29, 2026");
    expect(html).toContain('class="lsub" title="ada@example.com">Ada</span>');
  });

  it("preserves literal string semantics for unsupported and malformed displays", () => {
    const displays: JsonObject[] = [
      { type: "VALUE_TYPE_DECIMAL" },
      { type: "VALUE_TYPE_BOOLEAN" },
      { type: "FUTURE_TYPE" },
      { type: "DATE", temporal: { precision: [] } },
    ];
    for (const display of displays) {
      const html = renderListItem({
        title: "0012.50 <raw>",
        titleDisplay: display,
        subtitle: "<literal>",
        subtitleDisplay: display,
      });
      expect(html).toContain("0012.50 &lt;raw&gt;");
      expect(html).toContain("&lt;literal&gt;");
      expect(html).not.toContain("<raw>");
      expect(html).not.toContain("<literal>");
    }
  });
});

describe("vanilla assistant table displays", () => {
  it("formats declared cells while preserving fallbacks, missing cells, and escaping", () => {
    const html = renderBlock({
      table: {
        columns: [
          { key: "created", label: "Created" },
          { key: "owner", label: "Owner" },
          { key: "raw", label: "Raw" },
          { key: "missing", label: "Missing" },
          { key: "escaped", label: "Escaped" },
        ],
        rows: [{
          cells: {
            created: "raw-date",
            owner: "raw-owner",
            raw: "0012.50 <raw>",
            escaped: "unused",
          },
          displayCells: {
            created: { value: "2026-03-29T00:00:00Z", display: { type: "VALUE_TYPE_DATE" } },
            owner: {
              value: "Ada <ada@example.com>",
              display: {
                type: "VALUE_TYPE_PRINCIPAL",
                principal: { display: "PRINCIPAL_DISPLAY_NAME_WITH_EMAIL_TITLE" },
              },
            },
            raw: { value: "0012.50 <raw>", display: { type: "VALUE_TYPE_DECIMAL" } },
            escaped: { value: "<script>alert(1)</script>", display: { type: "FUTURE_TYPE" } },
          },
        }],
      },
    });

    expect(html).toContain("<td>Mar 29, 2026</td>");
    expect(html).toContain('<td title="ada@example.com">Ada</td>');
    expect(html).toContain("<td>0012.50 &lt;raw&gt;</td>");
    expect(html).toContain("<td></td>");
    expect(html).toContain("<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("raw-date");
    expect(html).not.toContain("raw-owner");
  });
});

describe("vanilla assistant field displays", () => {
  it("formats supported fields and preserves literal, malformed, and escaped fallbacks", () => {
    const html = renderBlock({
      fields: {
        fields: [
          { key: "Created", value: "2026-03-29T00:00:00Z", display: { type: "VALUE_TYPE_DATE" } },
          {
            key: "Owner",
            value: "Ada <ada@example.com>",
            display: {
              type: "VALUE_TYPE_PRINCIPAL",
              principal: { display: "PRINCIPAL_DISPLAY_NAME_WITH_EMAIL_TITLE" },
            },
          },
          { key: "Raw", value: "0012.50 <raw>", display: { type: "VALUE_TYPE_DECIMAL" } },
          { key: "Future", value: "<script>alert(1)</script>", display: { type: "FUTURE_TYPE" } },
          { key: "Empty", value: "", display: { type: "VALUE_TYPE_DATE" } },
        ],
      },
    });

    expect(html).toContain("<div>Mar 29, 2026</div>");
    expect(html).toContain('<div title="ada@example.com">Ada</div>');
    expect(html).toContain("<div>0012.50 &lt;raw&gt;</div>");
    expect(html).toContain("<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>");
    expect(html).toContain('<div class="k">Empty</div><div></div>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<raw>");
  });
});
