// @vitest-environment jsdom

import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import { ValueDisplaySchema, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { formatByDisplay } from "@savvifi/meridian-schemas/uiview";
import { describe, expect, it } from "vitest";

import { registerAssistantPanel } from "../src/assistant_panel.js";

function renderListItem(item: Record<string, unknown>): string {
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
    block: { blockId: "list", list: { items: [item] } },
  });
  return panel.querySelector(".asst-row")?.innerHTML ?? "";
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
