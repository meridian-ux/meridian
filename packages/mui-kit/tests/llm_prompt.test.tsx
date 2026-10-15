import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { promptFixture } from "../../../schemas/conformance/prompt.js";

import { FormFieldSchema, TextInputSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { LlmPromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { MeridianProvider, PanelRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { muiKit } from "../src/mui_kit.js";

afterEach(cleanup);

describe("MUI LlmPromptPanel", () => {
  it("renders prompt metadata, templates, and typed slot controls", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "prompt-preview",
      title: "Prompt preview",
      body: {
        case: "llmPrompt",
        value: create(LlmPromptPanelSchema, {
          description: "A greeting prompt",
          systemTemplate: "You are helpful.",
          userTemplate: "Hello {{name}}",
          modelHint: { provider: "openai", model: "gpt-test" },
          slots: [{
            name: "name",
            field: create(FormFieldSchema, {
              fieldId: "name",
              label: "Name",
              kind: { case: "text", value: create(TextInputSchema, { defaultValue: "Ada" }) },
            }),
          }],
        }),
      },
    });
    const invoker: RpcInvoker = { invoke: async () => ({}) };
    render(
      <MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}}>
        <PanelRenderer descriptor={descriptor} />
      </MeridianProvider>,
    );
    expect(screen.getByText("A greeting prompt")).toBeTruthy();
    expect(screen.getByText("You are helpful.")).toBeTruthy();
    expect(screen.getByText("Hello {{name}}")).toBeTruthy();
    expect(screen.getByText("openai")).toBeTruthy();
    expect(screen.getByText("gpt-test")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });
});

function fixture() {
  const source = promptFixture(); if (source.body.case !== "prompt") throw new Error();
  return create(PanelDescriptorSchema, { panelId: "preview", body: { case: "llmPrompt", value: {
    description: "Preview only", systemTemplate: "Use {{text}}.",
    userTemplate: "{{text}} / [{{empty}}] / {{integer}} / {{number}} / {{boolean}} / {{enum}} / {{masked}} / {{nested}} / {{items}} / {{map}} / {{document}} / {{missing}}",
    modelHint: { provider: "local", model: "test-model", maxTokens: 256, temperature: 0.5 }, outputJsonSchema: '{"type":"object"}',
    slots: [...source.body.value.fields.map(field => ({ name: field.fieldId, field: { ...field, fieldId: `different-${field.fieldId}` } })),
      { name: "document", multiLine: true, rows: 6, field: { label: "Document", kind: { case: "text", value: { defaultValue: "A document" } } } }],
  } } });
}
const view = (descriptor = fixture(), invoke = vi.fn(async () => ({})), admission?: Parameters<typeof MeridianProvider>[0]["admission"]) =>
  <MeridianProvider kit={muiKit} invoker={{ invoke }} adhoc={{}} admission={admission}><PanelRenderer descriptor={descriptor} /></MeridianProvider>;
const user = (container: HTMLElement) => container.querySelector('[aria-label="User prompt"] pre')!.textContent;
const submit = (container: HTMLElement) => fireEvent.submit(container.querySelector("form")!);

describe("MUI local LLM preview", () => {
  it("edits multiline masked values without plaintext controls and conceals every new preview", () => {
    const descriptor = create(PanelDescriptorSchema, { panelId: "masked", body: { case: "llmPrompt", value: {
      userTemplate: "{{secret}} {{nested}}", slots: [
        { name: "secret", multiLine: true, rows: 6, field: { label: "Secret", kind: { case: "masked", value: { defaultValue: "first\r\n\r\nlast\n" } } } },
        { name: "nested", field: { kind: { case: "nested", value: { fields: [{ fieldId: "token", kind: { case: "masked", value: { defaultValue: "nested-secret" } } }] } } } },
      ],
    } } });
    const invoke = vi.fn(), { container } = render(view(descriptor, invoke));
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("first");
    fireEvent.change(screen.getByLabelText("Secret, line 1"), { target: { value: "edited" } });
    submit(container); expect(user(container)).toBe("•••••• ••••••");
    fireEvent.click(screen.getByRole("button", { name: "Show masked values in preview" }));
    expect(user(container)).toBe('edited\r\n\r\nlast\n {"token":"nested-secret"}');
    submit(container); expect(user(container)).toBe("•••••• ••••••"); expect(invoke).not.toHaveBeenCalled();
  });
  it("previews all typed defaults and multiline edits literally without executing a provider or mutating the descriptor", () => {
    const descriptor = fixture(), before = JSON.stringify(descriptor), invoke = vi.fn(async () => ({}));
    const { container } = render(view(descriptor, invoke));
    expect((screen.getByLabelText("Document") as HTMLTextAreaElement).rows).toBe(6);
    expect((screen.getByLabelText("Secret") as HTMLInputElement).type).toBe("password");
    for (const value of ["local", "test-model", "256", "0.5", '{"type":"object"}']) expect(container.textContent).toContain(value);
    submit(container);
    expect(user(container)).toBe('Keep this / [] / 0 / -1.5 / false / token / •••••• / {"name":"Ada"} / [1.5] / {} / A document / {{missing}}');
    fireEvent.click(screen.getByRole("button", { name: "Show masked values in preview" }));
    expect(user(container)).toContain("/ secret /");
    fireEvent.change(screen.getByLabelText("Document"), { target: { value: '<script>literal</script>\n{{text}} $&' } }); submit(container);
    expect(user(container)).not.toContain("secret");
    expect(user(container)).toContain('<script>literal</script>\n{{text}} $& / {{missing}}');
    expect(container.querySelector("script")).toBeNull(); expect(screen.getByText("Unresolved slots: missing")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled(); expect(JSON.stringify(descriptor)).toBe(before);
  });
  it("keeps the last valid preview when an edited input fails validation", () => {
    const { container } = render(view()); submit(container); const before = user(container);
    fireEvent.change(screen.getByLabelText("Integer"), { target: { value: "1.5" } }); submit(container);
    expect(screen.getByRole("alert").textContent).toContain("invalid number"); expect(user(container)).toBe(before);
  });
  it("resets both edits and preview when the authored prompt changes", () => {
    const { container, rerender } = render(view()); fireEvent.change(screen.getByLabelText("Document"), { target: { value: "Edited" } }); submit(container);
    const next = fixture(); if (next.body.case !== "llmPrompt") throw new Error(); next.body.value.userTemplate = "New {{document}}";
    rerender(view(next)); expect(user(container)).toBe("New {{document}}"); expect((screen.getByLabelText("Document") as HTMLTextAreaElement).value).toBe("A document");
  });
  it("loads option tokens through the gated read invoker before preview", async () => {
    const descriptor = dynamicFixture(); let resolve!: (value: object) => void;
    const invoke = vi.fn(() => new Promise<object>(done => { resolve = done; })); const { container } = render(view(descriptor, invoke));
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);
    resolve({ options: [{ id: "west", label: "Western region" }] });
    await waitFor(() => expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(false)); submit(container);
    expect(user(container)).toBe("Region west"); expect(invoke).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledWith("fixture.Options", "List", {});
  });
  it("makes option failures retryable without executing the LLM", async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ options: [{ id: "west" }] });
    const { container } = render(view(dynamicFixture(), invoke));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Retry options" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(false)); submit(container);
    expect(user(container)).toBe("Region west"); expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("does not bypass host read admission for an options source", async () => {
    const invoke = vi.fn(async () => ({})); render(view(dynamicFixture(), invoke, { reads: [] }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBeTruthy()); expect(invoke).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("ignores late option replies after replacement and renders slotless/missing-input templates honestly", async () => {
    let resolve!: (value: object) => void; const invoke = vi.fn(() => new Promise<object>(done => { resolve = done; }));
    const { container, rerender } = render(view(dynamicFixture(), invoke));
    const next = create(PanelDescriptorSchema, { body: { case: "llmPrompt", value: { userTemplate: "{{unknown}}", slots: [{ name: "unknown" }] } } });
    rerender(view(next)); resolve({ options: [{ id: "late" }] });
    await waitFor(() => expect(user(container)).toBe("{{unknown}}")); expect(screen.getByText("No input declared for unknown.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull(); expect(container.textContent).not.toContain("late");
  });
});

function dynamicFixture() {
  return create(PanelDescriptorSchema, { panelId: "dynamic", body: { case: "llmPrompt", value: { userTemplate: "Region {{region}}", slots: [{ name: "region", field: {
    fieldId: "different", label: "Region", kind: { case: "enumSelection", value: { defaultValue: "west", optionsSource: { service: "fixture.Options", method: "List", optionsField: "options", valueField: "id", labelField: "label" } } },
  } }] } } });
}
