// @vitest-environment jsdom
import { toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promptFixture, expectedPromptValues } from "../../../schemas/conformance/prompt.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { reactWebRenderer } from "../src/react_web_renderer.js";
import type { PromptResponseHandler } from "@savvifi/meridian-schemas/uiview";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
const submit = (container: HTMLElement) => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} prompt responses`, () => {
  it("returns canonical typed defaults through the WebRenderer seam with no RPC", async () => {
    const container = document.createElement("div"), invoke = vi.fn(), onPromptResponse = vi.fn(); document.body.append(container);
    let handle!: ReturnType<ReturnType<typeof reactWebRenderer>["mount"]>;
    try {
      await act(async () => { handle = reactWebRenderer(kit).mount({ container, descriptor: promptFixture(), invoker: { invoke }, onPromptResponse }); });
      await act(async () => { submit(container); });
      expect(onPromptResponse).toHaveBeenCalledTimes(1); expect(onPromptResponse.mock.calls[0][0]).toBe("collect");
      expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual(toJson(StructSchema, expectedPromptValues));
      expect(container.querySelector("script")).toBeNull(); expect(invoke).not.toHaveBeenCalled();
      await act(async () => { submit(container); }); expect(onPromptResponse).toHaveBeenCalledTimes(1);
    } finally { await act(async () => { (await handle).unmount(); }); container.remove(); }
  });

  it.each([true, false, null])("returns confirmation/cancellation %s without collecting ignored fields", async value => {
    const container = document.createElement("div"), root = createRoot(container), onPromptResponse = vi.fn(); document.body.append(container);
    try {
      await act(async () => root.render(createElement(StrictMode, null, createElement(MeridianProvider, {
        kit, invoker: { invoke: vi.fn() }, adhoc: {}, onPromptResponse,
        children: createElement(PanelRenderer, { descriptor: promptFixture(true) }),
      }))));
      expect(container.querySelector("input")).toBeNull();
      await act(async () => {
        if (value === null) container.querySelector("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else if (value) submit(container); else container.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
      });
      expect(onPromptResponse).toHaveBeenCalledTimes(1);
      if (value === null) expect(onPromptResponse.mock.calls[0][1]).toBeNull();
      else expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ collect: value });
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("makes missing handlers explicit, validates edits, and retries host failures without clearing inputs", async () => {
    const container = document.createElement("div"), root = createRoot(container), descriptor = promptFixture(); document.body.append(container);
    const render = (onPromptResponse?: PromptResponseHandler) => createElement(MeridianProvider, {
      kit, invoker: { invoke: vi.fn() }, adhoc: {}, onPromptResponse, children: createElement(PanelRenderer, { descriptor }),
    });
    const onPromptResponse = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    try {
      await act(async () => root.render(render())); expect(container.textContent).toContain("No prompt handler configured");
      expect(container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
      await act(async () => root.render(render(onPromptResponse)));
      const text = container.querySelector<HTMLInputElement>('[name="rpc_only"]')!; text.value = "x";
      await act(async () => { submit(container); }); expect(onPromptResponse).not.toHaveBeenCalled(); expect(container.textContent).toContain("invalid length");
      text.value = "Keep edits"; await act(async () => { submit(container); }); expect(container.textContent).toContain("offline"); expect(text.value).toBe("Keep edits");
      await act(async () => { submit(container); }); expect(onPromptResponse).toHaveBeenCalledTimes(2); expect(container.textContent).toContain("Submitted.");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });

  it("deduplicates pending callbacks and isolates descriptor replacement from late failures", async () => {
    const container = document.createElement("div"), root = createRoot(container); document.body.append(container);
    let reject!: (reason: Error) => void; const onPromptResponse = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const render = (descriptor = promptFixture()) => createElement(MeridianProvider, {
      kit, invoker: { invoke: vi.fn() }, adhoc: {}, onPromptResponse, children: createElement(PanelRenderer, { descriptor }),
    });
    try {
      await act(async () => root.render(render()));
      const oldForm = container.querySelector("form")!;
      await act(async () => { submit(container); submit(container); }); expect(onPromptResponse).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("Submitting…"); const next = promptFixture(); next.panelId = "next";
      await act(async () => root.render(render(next)));
      await act(async () => { reject(new Error("late")); }); expect(container.textContent).not.toContain("late");
      await act(async () => { oldForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); expect(onPromptResponse).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
