// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ViewDescriptorSchema, type ViewDescriptor } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { ComponentKit } from "../src/component_kit.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { ViewRenderer } from "../src/view_renderer.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function fixture(labels = ["First", "Second", "Third"]): ViewDescriptor {
  return create(ViewDescriptorSchema, {
    id: "settings", title: "Settings", layout: { mode: { case: "tabbed", value: {} } },
    slots: [
      { id: "region", panel: { panelId: "summary", body: { case: "adhoc", value: { handlerId: "content" } } } },
      ...labels.map((label, index) => ({ id: `tab-${index}`, position: index + 1,
        placement: { tabLabel: label, tabPosition: index },
        panel: { panelId: label, body: { case: "adhoc" as const, value: { handlerId: "content" } } },
      })),
    ],
  });
}

async function mount(kit: ComponentKit, view: ViewDescriptor) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container), invoke = vi.fn(async () => ({}));
  const update = async (next: ViewDescriptor) => { await act(async () => root.render(createElement(MeridianProvider, {
    kit, invoker: { invoke }, adhoc: { content: ({ descriptor }) => createElement("p", null, `content:${descriptor.panelId}`) },
    children: createElement(ViewRenderer, { view: next }),
  }))); };
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  await update(view);
  return { container, update, invoke };
}

const buttons = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('.mer-tabstrip > [role="tab"]')];
async function key(button: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => { button.dispatchEvent(event); });
  return event;
}

for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} view tab navigation`, () => {
  it("names the strip and associates every tab with a panel while mounting only the selected body", async () => {
    const { container, invoke } = await mount(kit, fixture());
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Settings sections");
    const tabs = buttons(container);
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1]);
    for (const [index, tab] of tabs.entries()) {
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panel?.hidden).toBe(index !== 0);
    }
    expect(container.textContent).toContain("content:summary");
    expect(container.textContent).toContain("content:First");
    expect(container.textContent).not.toContain("content:Second");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("moves focus without activating/fetching, wraps, and leaves vertical arrows for page scrolling", async () => {
    const { container } = await mount(kit, fixture());
    const tabs = buttons(container);
    await act(async () => tabs[0].focus());
    expect((await key(tabs[0], "ArrowRight")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, 0, -1]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).not.toContain("content:Second");
    // Enter/Space retain the native button activation path, represented by click
    // in jsdom. The real Chrome suite exercises the actual key-to-click behavior.
    await act(async () => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("content:Second");
    await key(tabs[1], "End"); expect(document.activeElement).toBe(tabs[2]);
    await key(tabs[2], "ArrowRight"); expect(document.activeElement).toBe(tabs[0]);
    await key(tabs[0], "ArrowLeft"); expect(document.activeElement).toBe(tabs[2]);
    await key(tabs[2], "Home"); expect(document.activeElement).toBe(tabs[0]);
    expect((await key(tabs[0], "ArrowDown")).defaultPrevented).toBe(false);
    expect((await key(tabs[0], "ArrowUp")).defaultPrevented).toBe(false);
    expect((await key(tabs[0], "Tab")).defaultPrevented).toBe(false);
    const modified = new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true });
    await act(async () => { tabs[0].dispatchEvent(modified); });
    expect(modified.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tabs[0]);
    const outside = document.createElement("button"); container.append(outside);
    await act(async () => outside.focus());
    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("does not populate a focused inactive panel until activation", async () => {
    const view = fixture();
    view.slots[2].panel = create(PanelDescriptorSchema, {
      panelId: "remote", body: { case: "table", value: {
        rowsField: "rows", columns: [{ header: "Name" }], populate: { service: "Items", method: "List" },
      } },
    });
    const { container, invoke } = await mount(kit, view);
    const tabs = buttons(container);
    await act(async () => tabs[0].focus());
    await key(tabs[0], "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]);
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => tabs[1].click());
    expect(invoke).toHaveBeenCalledWith("Items", "List", {});
  });

  it("keeps selection and associations valid when tabs shrink or disappear", async () => {
    const { container, update } = await mount(kit, fixture());
    await act(async () => buttons(container)[2].click());
    await update(fixture(["Only"]));
    const [tab] = buttons(container);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.tabIndex).toBe(0);
    expect(document.getElementById(tab.getAttribute("aria-controls")!)?.textContent).toContain("content:Only");
    await update(fixture([]));
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).toContain("content:summary");
  });

  it("uses distinct associations for nested views even with identical view/slot IDs", async () => {
    const view = fixture();
    view.slots[1].subView = fixture();
    const { container } = await mount(kit, view);
    const tabs = buttons(container);
    expect(tabs).toHaveLength(6);
    expect(new Set(tabs.map(tab => tab.id)).size).toBe(6);
    const targets = tabs.map(tab => tab.getAttribute("aria-controls"));
    expect(new Set(targets).size).toBe(6);
    for (const tab of tabs) expect(document.getElementById(tab.getAttribute("aria-controls")!)?.getAttribute("aria-labelledby")).toBe(tab.id);
  });
});
