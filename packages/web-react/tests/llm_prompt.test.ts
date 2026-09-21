// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LlmPromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const fixture = () => create(PanelDescriptorSchema, {
  panelId: "preview", title: "Prompt preview",
  body: { case: "llmPrompt", value: create(LlmPromptPanelSchema, {
    description: "Summarize with parameters", systemTemplate: "Use {{style}}.",
    userTemplate: "{{document}} / {{count}} / {{enabled}} / {{missing}}",
    modelHint: { provider: "local", model: "test-model", maxTokens: 256, temperature: 0.5 },
    outputJsonSchema: '{"type":"object"}',
    slots: [
      { name: "style", field: { label: "Style", kind: { case: "enumSelection", value: { allowedValues: ["brief", "detailed"], defaultValue: "brief" } } } },
      { name: "document", multiLine: true, rows: 6, field: { fieldId: "different", requestField: "also-different", label: "Document", description: "Paste text", kind: { case: "text", value: { defaultValue: "A document" } } } },
      { name: "count", multiLine: true, field: { label: "Count", kind: { case: "integer", value: { min: 1, max: 10, defaultValue: 2 } } } },
      { name: "enabled", field: { label: "Enabled", kind: { case: "boolean", value: { defaultValue: true } } } },
      { name: "secret", field: { kind: { case: "masked", value: { defaultValue: "hidden" } } } },
      { name: "unconfigured" },
    ],
  }) },
});

for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} LlmPrompt`, () => {
  const invoke = vi.fn(async () => ({}));
  const view = (descriptor = fixture()) => createElement(MeridianProvider,
    { kit, invoker: { invoke }, adhoc: {} }, createElement(PanelRenderer, { descriptor }));

  it("renders model metadata, templates, schema, and typed accessible slot inputs", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(view());
    expect(container.textContent).not.toContain("unsupported panel shape");
    for (const text of ["Summarize with parameters", "local", "test-model", "256", "0.5", "Use {{style}}.", '{"type":"object"}', "No input declared for unconfigured."])
      expect(container.textContent).toContain(text);
    const textarea = container.querySelector("textarea")!;
    expect(textarea.rows).toBe(6);
    expect(textarea.defaultValue).toBe("A document");
    expect(textarea.closest("label")?.textContent).toContain("Document");
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("2");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("hidden");
    expect(container.querySelector("select")?.value).toBe("brief");
  });

  it("previews edited values once as text, retains unresolved tokens, and makes no RPC", async () => {
    invoke.mockClear();
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(view()));
      container.querySelector("textarea")!.value = '<script>unsafe</script> {{style}} $&';
      container.querySelector("select")!.value = "detailed";
      container.querySelector<HTMLInputElement>('input[type="number"]')!.value = "3";
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = false;
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(container.querySelector('[aria-label="System prompt"] pre')?.textContent).toBe("Use detailed.");
      expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent).toBe('<script>unsafe</script> {{style}} $& / 3 / false / {{missing}}');
      expect(container.querySelector("script")).toBeNull();
      expect(container.textContent).toContain("Unresolved slots: missing");
      expect(invoke).not.toHaveBeenCalled();
      // A new descriptor resets local inputs and preview values.
      const next = fixture();
      if (next.body.case === "llmPrompt") next.body.value.userTemplate = "New {{document}}";
      await act(async () => root.render(view(next)));
      expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent).toBe("New {{document}}");
      expect(container.querySelector("textarea")!.value).toBe("A document");
    } finally { await act(async () => root.unmount()); }
  });

  it("previews nested, repeated, and map slots using shared form control values", async () => {
    const descriptor = fixture();
    if (descriptor.body.case !== "llmPrompt") throw new Error("invalid fixture");
    descriptor.body.value = create(LlmPromptPanelSchema, {
      userTemplate: "{{record}} {{items}} {{map}}",
      slots: [
        { name: "record", field: { kind: { case: "nested", value: { fields: [{ fieldId: "label", kind: { case: "text", value: { defaultValue: "Ada" } } }] } } } },
        { name: "items", field: { kind: { case: "repeated", value: { minItems: 1, element: { case: "scalar", value: { kind: { case: "number", value: { defaultValue: 1.5 } } } } } } } },
        { name: "map", field: { kind: { case: "keyValueMap", value: {} } } },
      ],
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(view(descriptor)));
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent).toBe('{"label":"Ada"} [1.5] {}');
    } finally { await act(async () => root.unmount()); }
  });
});
