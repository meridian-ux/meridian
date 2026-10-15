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
import { MaskedMultiline } from "../src/masked_multiline.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

describe("masked multiline editor", () => {
  it("keeps raw CRLF form data in native password controls and supports split, join, paste, drop, and IME", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const input = (index: number) => container.querySelectorAll<HTMLInputElement>('input[type="password"]')[index];
    const raw = () => new FormData(container.querySelector("form")!).get("secret");
    const key = async (index: number, name: string, position: number, composing = false) => {
      input(index).setSelectionRange(position, position);
      await act(async () => input(index).dispatchEvent(new KeyboardEvent("keydown", { key: name, isComposing: composing, bubbles: true, cancelable: true })));
    };
    try {
      await act(async () => root.render(createElement("form", null, createElement(MaskedMultiline, { name: "secret", label: "Secret", defaultValue: "ab\r\ncd\r\n" }))));
      expect(container.querySelector("textarea")).toBeNull(); expect(container.textContent).not.toContain("ab");
      expect(raw()).toBe("ab\r\ncd\r\n");
      await key(0, "Enter", 1, true); expect(raw()).toBe("ab\r\ncd\r\n");
      await key(0, "Enter", 1); expect(raw()).toBe("a\r\nb\r\ncd\r\n");
      expect(document.activeElement).toBe(input(1)); expect(input(1).selectionStart).toBe(0);
      await key(1, "Backspace", 0); expect(raw()).toBe("ab\r\ncd\r\n");
      await key(0, "Delete", 2); expect(raw()).toBe("abcd\r\n");
      input(0).setSelectionRange(1, 3);
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { getData: () => "🦀\nX" } });
      await act(async () => input(0).dispatchEvent(paste)); expect(raw()).toBe("a🦀\nXd\r\n");
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "Z\rY" } });
      input(1).setSelectionRange(0, 1);
      await act(async () => input(1).dispatchEvent(drop)); expect(raw()).toBe("a🦀\nZ\rYd\r\n");
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  it("pages without truncating values, focuses hidden-page lines, and handles controlled shrink", async () => {
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    const raw = Array.from({ length: 102 }, (_, index) => `secret-${index}`).join("\r\n");
    try {
      await act(async () => root.render(createElement(MaskedMultiline, { label: "Secret", name: "secret", value: raw, rows: 2147483647 })));
      expect(container.querySelectorAll('input[type="password"]')).toHaveLength(100);
      expect(container.querySelector<HTMLInputElement>('input[type="hidden"]')!.value).toBe(raw);
      await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Next lines")!.click());
      expect(container.querySelectorAll('input[type="password"]')).toHaveLength(2);
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Secret, line 101");
      await act(async () => root.render(createElement(MaskedMultiline, { label: "Secret", name: "secret", value: "short", disabled: true })));
      expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
      expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("short");
      expect(container.querySelector("fieldset")!.disabled).toBe(true);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});

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

  it("preserves multiline masked slots while concealing each new preview", async () => {
    const descriptor = create(PanelDescriptorSchema, { panelId: "masked", body: { case: "llmPrompt", value: {
      userTemplate: "{{secret}}", slots: [{ name: "secret", multiLine: true, field: { label: "Secret", kind: { case: "masked", value: { defaultValue: "first\r\n\r\nlast\n" } } } }],
    } } });
    const container = document.createElement("div"), root = createRoot(container);
    try {
      await act(async () => root.render(view(descriptor)));
      expect(container.querySelector("textarea")).toBeNull(); expect(container.querySelectorAll('input[type="password"]')).toHaveLength(4);
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(container.querySelector('[aria-label="User prompt"] pre')!.textContent).toBe("••••••");
      await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Show masked values in preview")!.click());
      expect(container.querySelector('[aria-label="User prompt"] pre')!.textContent).toBe("first\r\n\r\nlast\n");
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(container.querySelector('[aria-label="User prompt"] pre')!.textContent).toBe("••••••");
    } finally { await act(async () => root.unmount()); }
  });

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

  it("substitutes scalar defaults once with slot names, preserving zero, false, and empty text", async () => {
    const descriptor = fixture();
    if (descriptor.body.case !== "llmPrompt") throw new Error("invalid fixture");
    descriptor.body.value = create(LlmPromptPanelSchema, {
      userTemplate: "{{a}} / {{b}} / [{{text}}] {{integer}} {{number}} {{boolean}} {{enum}} {{masked}} / {{ name }} / {{a.b}} / {{missing}}",
      slots: [
        { name: "a", field: { fieldId: "different", kind: { case: "text", value: { defaultValue: "{{b}}" } } } },
        { name: "b", field: { kind: { case: "text", value: { defaultValue: "{{a}}" } } } },
        { name: "text", field: { kind: { case: "text", value: { defaultValue: "" } } } },
        { name: "integer", field: { kind: { case: "integer", value: { defaultValue: 0 } } } },
        { name: "number", field: { kind: { case: "number", value: { defaultValue: -1.5 } } } },
        { name: "boolean", field: { kind: { case: "boolean", value: { defaultValue: false } } } },
        { name: "enum", field: { kind: { case: "enumSelection", value: { options: [{ value: "stored-token", label: "Shown label" }], defaultValue: "stored-token" } } } },
        { name: "masked", field: { kind: { case: "masked", value: { defaultValue: "secret" } } } },
        { name: "name", field: { kind: { case: "text", value: { defaultValue: "Ada $& <tag> 🦀" } } } },
        { name: "a.b", field: { kind: { case: "text", value: { defaultValue: "literal.name" } } } },
      ],
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(view(descriptor)));
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent).toBe(
        "{{b}} / {{a}} / [] 0 -1.5 false stored-token •••••• / Ada $& <tag> 🦀 / literal.name / {{missing}}",
      );
      await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Show masked values in preview")!.click());
      expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent).toContain("stored-token secret");
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent).not.toContain("secret");
      expect(container.querySelector("tag")).toBeNull();
      expect(container.textContent).toContain("Unresolved slots: missing");
    } finally { await act(async () => root.unmount()); }
  });
});
