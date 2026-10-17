// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeSchema, type Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { ViewRenderer } from "../src/view_renderer.js";
import { reactWebRenderer } from "../src/react_web_renderer.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
const invoker = { invoke: vi.fn(async () => ({})) };
const descriptor = create(PanelDescriptorSchema, { panelId: "themed", title: "Themed panel",
  body: { case: "stat", value: {} } });
const skin = create(ThemeSchema, { metrics: { radiusPx: 12, spacingScalePx: [0, 2, 6, 12], densityScale: 0.75, strokePx: 0 },
  typography: { baseSizePx: 19, bodyWeight: 500, headingWeight: 700 } });
function Counter() {
  const [count, setCount] = useState(0);
  return createElement("button", { onClick: () => setCount(value => value + 1) }, `Count ${count}`);
}

for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} actual theme binding`, () => {
  it("applies palette-free Metrics/Typography at existing roots and preserves state on replacement", async () => {
    const container = document.createElement("main"); document.body.append(container);
    container.style.setProperty("--mer-space-1", "17px");
    const root = createRoot(container), selected = { ...kit, Stat: Counter };
    const draw = (theme: Theme | undefined) => root.render(createElement(MeridianProvider, { kit: selected, theme, invoker, adhoc: {},
      children: createElement(PanelRenderer, { descriptor }) }));
    try {
      await act(async () => draw(skin));
      const panel = container.firstElementChild as HTMLElement, button = panel.querySelector("button")!;
      expect(panel.tagName).toBe("SECTION");
      expect(panel.style.getPropertyValue("--mer-space-1-5")).toBe("3px");
      expect(panel.style.getPropertyValue("--mer-stroke")).toBe("0px");
      expect(panel.style.fontSize).toBe("19px");
      expect(panel.style.fontWeight).toBe("500");
      expect(panel.style.borderRadius).toBe("12px");
      expect(panel.style.borderWidth).toBe("0px");
      expect((panel.querySelector("h2,h3") as HTMLElement).style.fontWeight).toBe("700");
      await act(async () => button.click());
      await act(async () => draw(create(ThemeSchema)));
      expect(container.firstElementChild).toBe(panel);
      expect(panel.querySelector("button")).toBe(button);
      expect(button.textContent).toBe("Count 1");
      expect(panel.style.getPropertyValue("--mer-space-1-5")).toBe("");
      expect(panel.style.getPropertyValue("--mer-stroke")).toBe("");
      expect(panel.style.fontSize).toBe("");
      expect((panel.querySelector("h2,h3") as HTMLElement).style.fontWeight).toBe("");
      expect(container.style.getPropertyValue("--mer-space-1")).toBe("17px");
      await act(async () => draw(undefined));
      expect(container.firstElementChild).toBe(panel);
      expect(panel.querySelector("button")).toBe(button);
      expect(button.textContent).toBe("Count 1");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  it("binds semantic palette roles and leaves omitted roles to host inheritance", () => {
    const style = kit.themeToStyle!(create(ThemeSchema, { light: { warning: "#abcdef", info: "#123456" } })) as Record<string, string>;
    expect(style["--mer-warning"]).toBe("#abcdef");
    expect(style["--mer-info"]).toBe("#123456");
    expect(style).not.toHaveProperty("--mer-bg");
    expect(style).not.toHaveProperty("background");
  });
  it("applies the binding to composed views, including the view heading", async () => {
    const container = document.createElement("main"), root = createRoot(container);
    try {
      await act(async () => root.render(createElement(MeridianProvider, { kit, theme: skin, invoker, adhoc: {},
        children: createElement(ViewRenderer, { view: create(ViewDescriptorSchema, { id: "themed-view", title: "View" }) }) })));
      const view = container.querySelector<HTMLElement>(".mer-view")!;
      expect(view.style.getPropertyValue("--mer-space-6")).toBe("9px");
      expect(view.querySelector<HTMLElement>(".mer-view-title")!.style.fontWeight).toBe("700");
    } finally { await act(async () => root.unmount()); }
  });
  it("carries Metrics through the public WebRenderer mount seam without owning host styles", async () => {
    const container = document.createElement("main"); document.body.append(container);
    container.style.setProperty("--mer-space-1", "17px");
    let handle: Awaited<ReturnType<ReturnType<typeof reactWebRenderer>["mount"]>> | undefined;
    try {
      await act(async () => { handle = await reactWebRenderer(kit).mount({ container, descriptor, theme: skin, invoker }); });
      expect((container.firstElementChild as HTMLElement).style.getPropertyValue("--mer-space-1")).toBe("1.5px");
      await act(async () => handle!.unmount()); handle = undefined;
      expect(container.children.length).toBe(0);
      expect(container.style.getPropertyValue("--mer-space-1")).toBe("17px");
    } finally { if (handle) await act(async () => handle!.unmount()); container.remove(); }
  });
});
