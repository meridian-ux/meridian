import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LAYOUT_CASES } from "../../../schemas/conformance/layout_cases.js";
import { MeridianProvider, ViewRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
describe("MUI canonical whole-view layout corpus", () => {
  it.each(LAYOUT_CASES)("$name", async fixture => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const invoke = vi.fn(async (service: string, method: string) => fixture.responses[`${service}.${method}`] ?? {});
    // Includes invalid external scope scalars to test fail-closed runtime gates.
    const values = fixture.context.selections as Record<string, string> | undefined;
    try {
      await act(async () => root.render(createElement(MeridianProvider, { kit: muiKit, invoker: { invoke }, adhoc: {},
        children: createElement(ViewRenderer, { view: fixture.view, selection: { values: values ?? {}, set() {} } }),
      })));
      expect(container.textContent).toContain(fixture.view.title);
      for (const text of fixture.content) expect(container.textContent).toContain(text);
      expect([...container.querySelectorAll('[data-slot]')].map(e => e.getAttribute("data-slot"))).toEqual(fixture.order);
      const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      expect(tabs.map(tab => tab.textContent)).toEqual(fixture.tabs);
      if (tabs.length) {
        await act(async () => { tabs[0].focus(); tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
        expect(document.activeElement).toBe(tabs[1]); expect(tabs[0].getAttribute("aria-selected")).toBe("true");
        await act(async () => tabs[1].click());
        expect(container.textContent).toContain("Content first"); expect(container.textContent).not.toContain("Content last");
      }
      if (fixture.name.startsWith("gate-")) {
        expect(invoke).toHaveBeenCalledTimes(fixture.gateOpen ? 1 : 0);
        expect(container.textContent).toContain(fixture.gateOpen ? "Fetched scoped" : "Choose a scope first");
      } else if (fixture.name === "repeated") {
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain("001.20"); expect(container.textContent).toContain("Second row");
      } else expect(invoke).not.toHaveBeenCalled();
      if (fixture.name === "nested") expect(container.textContent).not.toContain("Content nested");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
