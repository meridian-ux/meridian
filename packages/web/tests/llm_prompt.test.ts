// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { TextInputSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { LlmPromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it, vi } from "vitest";
import { disposePanel, renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import { buildMaskedMultiline } from "../src/uiview/masked_multiline.js";

const wasm: UiviewWasm = { renderTable: () => [] as RenderedRow[], buildPopulateRequest: () => ({}), readPath: () => null, buildRequest: () => ({}), renderTablePanel: () => [] as RenderedRow[], formatLroMetadata: () => "" };

describe("native DOM masked multiline editor", () => {
  it("edits exact separators with password inputs, paste, drop, Enter and boundary deletion", () => {
    const editor = buildMaskedMultiline("secret", "Secret", "ab\r\ncd\r\n", 4);
    const form = document.createElement("form"); form.append(editor.element); document.body.append(form);
    const input = (index: number) => form.querySelectorAll<HTMLInputElement>('input[type="password"]')[index];
    const key = (index: number, name: string, position: number, composing = false) => {
      input(index).setSelectionRange(position, position);
      input(index).dispatchEvent(new KeyboardEvent("keydown", { key: name, isComposing: composing, bubbles: true, cancelable: true }));
    };
    try {
      expect(form.querySelector("textarea")).toBeNull(); expect(form.textContent).not.toContain("ab");
      key(0, "Enter", 1, true); expect(editor.read()).toBe("ab\r\ncd\r\n");
      key(0, "Enter", 1); expect(editor.read()).toBe("a\r\nb\r\ncd\r\n"); expect(document.activeElement).toBe(input(1));
      key(1, "Backspace", 0); expect(editor.read()).toBe("ab\r\ncd\r\n");
      key(0, "Delete", 2); expect(editor.read()).toBe("abcd\r\n");
      input(0).setSelectionRange(1, 3);
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { getData: () => "🦀\nX" } }); input(0).dispatchEvent(paste);
      expect(editor.read()).toBe("a🦀\nXd\r\n");
      input(1).value = "changed"; input(1).dispatchEvent(new Event("input", { bubbles: true }));
      expect(editor.read()).toBe("a🦀\nchanged\r\n");
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "Z\rY" } });
      input(1).setSelectionRange(0, 7); input(1).dispatchEvent(drop);
      expect(editor.read()).toBe("a🦀\nZ\rY\r\n");
      expect(new FormData(form).get("secret")).toBe(editor.read());
      input(3).value = "new trailing content"; input(3).dispatchEvent(new Event("input", { bubbles: true }));
      Array.from(form.querySelectorAll("button")).find(button => button.textContent === "Add line")!.click();
      expect(editor.read()).toBe("a🦀\nZ\rY\r\nnew trailing content\n");
    } finally { form.remove(); }
  });
  it("pages through long secrets without truncating the raw value or mounting every line", () => {
    const raw = Array.from({ length: 102 }, (_, index) => `secret-${index}`).join("\r\n");
    const editor = buildMaskedMultiline("secret", "Secret", raw, 2147483647); document.body.append(editor.element);
    try {
      expect(editor.element.querySelectorAll('input[type="password"]')).toHaveLength(100);
      Array.from(editor.element.querySelectorAll("button")).find(button => button.textContent === "Next lines")!.click();
      expect(editor.element.querySelectorAll('input[type="password"]')).toHaveLength(2);
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Secret, line 101");
      expect(editor.read()).toBe(raw);
    } finally { editor.element.remove(); }
  });
});

it("renders LLM prompt templates, model metadata, and slots", async () => {
  const root = document.createElement("div");
  await renderPanel({ wasm, root, descriptor: create(PanelDescriptorSchema, {
    title: "Prompt", body: { case: "llmPrompt", value: create(LlmPromptPanelSchema, {
      description: "Greeting", systemTemplate: "You are helpful.", userTemplate: "Hello {{name}}",
      modelHint: { provider: "openai", model: "gpt-test" }, slots: [{ name: "name", field: { label: "Name" } }],
    }) },
  }), invoker: { invoke: async () => ({}) }, context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} } });
  expect(root.textContent).toContain("openai");
  expect(root.textContent).toContain("gpt-test");
  expect(root.textContent).toContain("Hello {{name}}");
  expect(root.textContent).toContain("Name");
});

const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const fixture = () => create(PanelDescriptorSchema, { panelId: "preview", body: { case: "llmPrompt", value: {
  description: "Preview, not execution", systemTemplate: "Use {{style}}.",
  userTemplate: "{{document}} / {{count}} / {{enabled}} / {{secret}} / {{empty}} / {{missing}}",
  modelHint: { provider: "local", model: "test-model", maxTokens: 256, temperature: 0.5 },
  outputJsonSchema: '{"type":"object"}',
  slots: [
    { name: "style", field: { label: "Style", kind: { case: "enumSelection", value: { options: [{ value: "brief", label: "Brief style" }, { value: "detailed", label: "Detailed style" }], defaultValue: "brief" } } } },
    { name: "document", multiLine: true, rows: 6, field: { fieldId: "different", label: "Document", kind: { case: "text", value: { defaultValue: "A document" } } } },
    { name: "count", multiLine: true, field: { label: "Count", kind: { case: "integer", value: { defaultValue: 0 } } } },
    { name: "enabled", field: { label: "Enabled", kind: { case: "boolean", value: { defaultValue: false } } } },
    { name: "secret", field: { label: "Secret", kind: { case: "masked", value: { defaultValue: "hidden" } } } },
    { name: "empty", field: { label: "Empty", kind: { case: "text", value: {} } } },
    { name: "unconfigured" },
  ],
} } });
const submit = (root: HTMLElement) => root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const user = (root: HTMLElement) => root.querySelector('[aria-label="User prompt"] pre')!.textContent;

describe("web-components LLM prompt interaction", () => {
  it("keeps multiline masked values lossless and conceals nested masked values in each new preview", async () => {
    const descriptor = create(PanelDescriptorSchema, { panelId: "masked", body: { case: "llmPrompt", value: {
      userTemplate: "{{secret}} {{nested}}", slots: [
        { name: "secret", multiLine: true, field: { label: "Secret", kind: { case: "masked", value: { defaultValue: "first\r\n\r\nlast\n" } } } },
        { name: "nested", field: { kind: { case: "nested", value: { fields: [{ fieldId: "token", kind: { case: "masked", value: { defaultValue: "nested-secret" } } }] } } } },
      ],
    } } });
    const root = document.createElement("div"), invoke = vi.fn();
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke } });
    expect(root.querySelector("textarea")).toBeNull(); submit(root); expect(user(root)).toBe("•••••• ••••••");
    Array.from(root.querySelectorAll("button")).find(button => button.textContent === "Show masked values in preview")!.click();
    expect(user(root)).toBe('first\r\n\r\nlast\n {"token":"nested-secret"}');
    submit(root); expect(user(root)).toBe("•••••• ••••••"); expect(invoke).not.toHaveBeenCalled(); disposePanel(root);
  });
  it("previews scalar defaults/edits once as text, keeps unknown tokens, and never executes an RPC", async () => {
    const root = document.createElement("div"), invoke = vi.fn(async () => ({}));
    const descriptor = fixture();
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke } }); await flush();
    for (const value of ["local", "test-model", "256", "0.5", '{"type":"object"}', "No input declared for unconfigured."]) expect(root.textContent).toContain(value);
    const textarea = root.querySelector("textarea")!; expect(textarea.rows).toBe(6); expect(textarea.value).toBe("A document");
    expect(root.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("hidden");
    expect(root.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("0");
    expect(root.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    textarea.value = '<script>unsafe</script>\n{{style}} $&';
    root.querySelector("select")!.value = "detailed"; submit(root);
    expect(user(root)).toBe('<script>unsafe</script>\n{{style}} $& / 0 / false / •••••• /  / {{missing}}');
    Array.from(root.querySelectorAll("button")).find(button => button.textContent === "Show masked values in preview")!.click();
    expect(user(root)).toContain("/ hidden /");
    submit(root); expect(user(root)).not.toContain("hidden");
    expect(root.querySelector('[aria-label="System prompt"] pre')!.textContent).toBe("Use detailed.");
    expect(root.querySelector("script")).toBeNull(); expect(root.textContent).toContain("Unresolved slots: missing");
    expect(invoke).not.toHaveBeenCalled();
    if (descriptor.body.case !== "llmPrompt") throw new Error();
    expect(descriptor.body.value.slots[1].field!.fieldId).toBe("different");
    expect(descriptor.body.value.slots[1].field!.label).toBe("Document");
    disposePanel(root);
  });

  it("reads nested objects, repeated typed defaults and edits, and string maps", async () => {
    const descriptor = fixture(); if (descriptor.body.case !== "llmPrompt") throw new Error();
    descriptor.body.value = create(LlmPromptPanelSchema, { userTemplate: "{{record}} {{items}} {{map}}", slots: [
      { name: "record", field: { label: "Record", kind: { case: "nested", value: { fields: [{ fieldId: "label", label: "Name", kind: { case: "text", value: { defaultValue: "Ada" } } }] } } } },
      { name: "items", field: { label: "Items", kind: { case: "repeated", value: { minItems: 1, maxItems: 2, element: { case: "scalar", value: { label: "Item", kind: { case: "number", value: { defaultValue: 1.5 } } } } } } } },
      { name: "map", field: { label: "Map", kind: { case: "keyValueMap", value: { maxItems: 2 } } } },
    ] });
    const root = document.createElement("div");
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke: vi.fn() } }); await flush();
    submit(root); expect(user(root)).toBe('{"label":"Ada"} [1.5] {}');
    Array.from(root.querySelectorAll("button")).find(button => button.textContent === "Add item")!.click();
    const numbers = root.querySelectorAll<HTMLInputElement>('input[type="number"]'); numbers[0].value = "0"; numbers[1].value = "-2.5";
    root.querySelector("textarea")!.value = '{"team":"core"}'; submit(root);
    expect(user(root)).toBe('{"label":"Ada"} [0,-2.5] {"team":"core"}');
    disposePanel(root);
  });

  it("shows validation failures without overwriting the last valid preview and resets on descriptor change", async () => {
    const root = document.createElement("div"), descriptor = fixture();
    if (descriptor.body.case !== "llmPrompt") throw new Error();
    descriptor.body.value.slots[1].field!.kind = { case: "text", value: create(TextInputSchema, { minLength: 2 }) };
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke: vi.fn() } }); await flush();
    const textarea = root.querySelector("textarea")!; textarea.value = "Valid"; submit(root); const prior = user(root);
    textarea.value = "x"; submit(root); expect(root.querySelector('[role="alert"]')!.textContent).toContain("invalid length"); expect(user(root)).toBe(prior);
    const oldForm = root.querySelector("form")!, oldOutput = root.querySelector('[aria-label="User prompt"] pre')!;
    await renderPanel({ root, wasm, context, descriptor: fixture(), invoker: { invoke: vi.fn() } }); await flush();
    expect(user(root)).toContain("{{document}}");
    textarea.value = "Old edited value"; oldForm.dispatchEvent(new Event("submit", { cancelable: true })); expect(oldOutput.textContent).toBe(prior);
    expect(user(root)).not.toContain("Old edited value"); disposePanel(root);
  });

  it("loads nested enum options through the gated read invoker and submits raw tokens, not labels", async () => {
    const root = document.createElement("div"), descriptor = fixture(); if (descriptor.body.case !== "llmPrompt") throw new Error();
    descriptor.body.value = create(LlmPromptPanelSchema, { userTemplate: "{{record}}", slots: [{ name: "record", field: { kind: { case: "nested", value: { fields: [{ fieldId: "region", label: "Region", kind: { case: "enumSelection", value: { defaultValue: "west", optionsSource: { service: "fixture.Options", method: "List", optionsField: "data.regions", valueField: "id", labelField: "label" } } } }] } } } }] });
    let resolve!: (value: object) => void;
    const invoke = vi.fn(() => new Promise<object>(done => { resolve = done; }));
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke } });
    expect(root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true); submit(root); expect(user(root)).toBe("{{record}}");
    resolve({ data: { regions: [{ id: "west", label: "Western region" }, { id: 0, label: "Zero region" }] } }); await flush();
    expect(invoke).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledWith("fixture.Options", "List", {});
    expect(root.querySelector("select")!.selectedOptions[0].textContent).toBe("Western region"); submit(root); expect(user(root)).toBe('{"region":"west"}');
    root.querySelector("select")!.value = "0"; submit(root); expect(user(root)).toBe('{"region":"0"}'); disposePanel(root);
  });

  it("makes option failures visible, retries, and ignores late responses after disposal", async () => {
    const root = document.createElement("div"), descriptor = fixture(); if (descriptor.body.case !== "llmPrompt") throw new Error();
    const field = descriptor.body.value.slots[0].field!; if (field.kind.case !== "enumSelection") throw new Error();
    field.kind.value.optionsSource = { $typeName: "meridian.ui.v1.OptionsSource", service: "fixture.Options", method: "List", optionsField: "options", valueField: "id", labelField: "label" };
    const invoke = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ options: [{ id: "brief", label: "Brief" }] });
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke } }); await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("offline"); expect(root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
    Array.from(root.querySelectorAll("button")).find(button => button.textContent === "Retry options")!.click(); await flush(); submit(root); expect(root.querySelector('[aria-label="System prompt"] pre')!.textContent).toBe("Use brief.");
    let resolve!: (value: object) => void;
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke: () => new Promise(done => { resolve = done; }) } });
    const form = root.querySelector("form")!, before = form.innerHTML; disposePanel(root);
    resolve({ options: [{ id: "late", label: "Late" }] }); await flush(); expect(form.innerHTML).toBe(before);
  });

  it("keeps slotless templates and unresolved tokens visible without transport", async () => {
    const root = document.createElement("div"), invoke = vi.fn();
    await renderPanel({ root, wasm, context, descriptor: create(PanelDescriptorSchema, { body: { case: "llmPrompt", value: { userTemplate: "Hello {{missing}}" } } }), invoker: { invoke } }); await flush();
    expect(user(root)).toBe("Hello {{missing}}"); expect(root.querySelector('[type="submit"]')).toBeNull(); expect(invoke).not.toHaveBeenCalled(); disposePanel(root);
  });

  it("does not bypass read admission for descriptor-authored options sources", async () => {
    const root = document.createElement("div"), descriptor = fixture(); if (descriptor.body.case !== "llmPrompt") throw new Error();
    const field = descriptor.body.value.slots[0].field!; if (field.kind.case !== "enumSelection") throw new Error();
    field.kind.value.optionsSource = { $typeName: "meridian.ui.v1.OptionsSource", service: "fixture.Options", method: "List", optionsField: "options", valueField: "id", labelField: "label" };
    const invoke = vi.fn();
    await renderPanel({ root, wasm, context, descriptor, admission: { reads: [] }, invoker: { invoke } }); await flush();
    expect(invoke).not.toHaveBeenCalled(); expect(root.querySelector('[role="alert"]')!.textContent).toContain("Could not load inputs");
    expect(root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true); disposePanel(root);
  });

  it.each([{}, { options: [null] }, { options: [{ id: {} }] }])("rejects malformed options responses: %j", async response => {
    const root = document.createElement("div"), descriptor = fixture(); if (descriptor.body.case !== "llmPrompt") throw new Error();
    const field = descriptor.body.value.slots[0].field!; if (field.kind.case !== "enumSelection") throw new Error();
    field.kind.value.optionsSource = { $typeName: "meridian.ui.v1.OptionsSource", service: "fixture.Options", method: "List", optionsField: "options", valueField: "id", labelField: "label" };
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke: async () => response } }); await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("Invalid option");
    expect(root.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true); disposePanel(root);
  });

  it("shows empty choices instead of submitting a fabricated token", async () => {
    const root = document.createElement("div"), descriptor = fixture(); if (descriptor.body.case !== "llmPrompt") throw new Error();
    const field = descriptor.body.value.slots[0].field!; if (field.kind.case !== "enumSelection") throw new Error();
    field.kind.value.options = []; field.kind.value.defaultValue = "";
    await renderPanel({ root, wasm, context, descriptor, invoker: { invoke: vi.fn() } });
    expect(root.querySelector("select")!.disabled).toBe(true); expect(root.querySelector("select")!.textContent).toBe("No options");
    submit(root); expect(root.querySelector('[role="alert"]')!.textContent).toContain("select an allowed value");
    expect(user(root)).toContain("{{document}}"); disposePanel(root);
  });
});
