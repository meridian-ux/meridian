// @vitest-environment jsdom

import { create, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { promptFixture, expectedPromptValues } from "../../../schemas/conformance/prompt.js";
import { FormFieldSchema, TextInputSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import { describe, expect, it, vi } from "vitest";

import { renderPanel, disposePanel } from "../src/uiview/renderer.js";
import { webComponentsRenderer } from "../src/uiview/web_components_renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";

const wasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: () => ({}),
  renderTablePanel: () => [] as RenderedRow[],
  formatLroMetadata: () => "",
};

describe("web-components PromptPanel", () => {
  it("renders descriptions, typed fields, and the accept action", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm,
      root,
      descriptor: create(PanelDescriptorSchema, {
        title: "Configure",
        body: {
          case: "prompt",
          value: create(PromptPanelSchema, {
            description: "Choose a name",
            detail: "This value is used as the deployment label.",
            fields: [{
              ...create(FormFieldSchema, {
                fieldId: "name",
                label: "Name",
                description: "Lowercase only",
                kind: { case: "text", value: create(TextInputSchema, { defaultValue: "demo" }) },
              }),
            }],
            acceptLabel: "Continue",
          }),
        },
      }),
      invoker: { invoke: async () => ({}) },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });
    expect(root.textContent).toContain("Choose a name");
    expect(root.textContent).toContain("This value is used as the deployment label.");
    expect((root.querySelector("input[name=name]") as HTMLInputElement | null)?.value).toBe("demo");
    expect(root.textContent).toContain("Continue");
  });
});

const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const submit = (root: HTMLElement) => root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));

describe("web-components prompt responses", () => {
  it("returns all typed defaults through the WebRenderer host seam, never an RPC", async () => {
    const root = document.createElement("div"), invoke = vi.fn(), onPromptResponse = vi.fn();
    const handle = await webComponentsRenderer(wasm).mount({ container: root, descriptor: promptFixture(), invoker: { invoke }, onPromptResponse });
    submit(root); await flush(); expect(onPromptResponse).toHaveBeenCalledTimes(1);
    expect(onPromptResponse.mock.calls[0][0]).toBe("collect");
    expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual(toJson(StructSchema, expectedPromptValues));
    expect(root.querySelector("script")).toBeNull(); expect(invoke).not.toHaveBeenCalled();
    submit(root); await flush(); expect(onPromptResponse).toHaveBeenCalledTimes(1); handle.unmount();
  });
  it("shows missing handlers, validates edits, and preserves inputs after a failed host response", async () => {
    const root = document.createElement("div"), descriptor = promptFixture(), invoke = vi.fn();
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke } });
    expect(root.textContent).toContain("No prompt handler configured"); expect(root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    const onPromptResponse = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke }, onPromptResponse });
    const text = root.querySelector<HTMLInputElement>('[name="text"]')!; text.value = "x"; submit(root); await flush();
    expect(onPromptResponse).not.toHaveBeenCalled(); expect(root.textContent).toContain("invalid length");
    text.value = "Keep edits"; submit(root); await flush(); expect(root.textContent).toContain("offline"); expect(text.value).toBe("Keep edits");
    submit(root); await flush(); expect(onPromptResponse).toHaveBeenCalledTimes(2); expect(root.textContent).toContain("Submitted."); disposePanel(root);
  });
  it.each([true, false, null])("distinguishes confirmation/cancellation %s and ignores form fields", async value => {
    const root = document.createElement("div"), onPromptResponse = vi.fn();
    await renderPanel({ root, wasm, context, descriptor: promptFixture(true), invoker: { invoke: vi.fn() }, onPromptResponse });
    expect(root.querySelector("input")).toBeNull();
    if (value === null) root.querySelector("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else if (value) submit(root); else root.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
    await flush(); expect(onPromptResponse).toHaveBeenCalledTimes(1);
    if (value === null) expect(onPromptResponse.mock.calls[0][1]).toBeNull();
    else expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ collect: value }); disposePanel(root);
  });
  it("deduplicates pending responses and ignores replies and stale forms after replacement", async () => {
    const root = document.createElement("div"), descriptor = promptFixture(); let reject!: (reason: Error) => void;
    const onPromptResponse = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke: vi.fn() }, onPromptResponse });
    const oldForm = root.querySelector("form")!, oldError = root.querySelector('[role="alert"]')!;
    submit(root); submit(root); expect(onPromptResponse).toHaveBeenCalledTimes(1); expect(root.textContent).toContain("Submitting…");
    const next = promptFixture(); next.panelId = "next";
    await renderPanel({ root, wasm, context, descriptor: next, invoker: { invoke: vi.fn() }, onPromptResponse: vi.fn() });
    reject(new Error("late")); await flush(); expect(root.textContent).not.toContain("late"); expect(oldError.textContent).toBe("");
    oldForm.dispatchEvent(new Event("submit", { cancelable: true })); expect(onPromptResponse).toHaveBeenCalledTimes(1); disposePanel(root);
  });
});
