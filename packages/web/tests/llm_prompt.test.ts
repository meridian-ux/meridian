// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { LlmPromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it } from "vitest";
import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";

const wasm: UiviewWasm = { renderTable: () => [] as RenderedRow[], buildPopulateRequest: () => ({}), readPath: () => null, buildRequest: () => ({}), renderTablePanel: () => [] as RenderedRow[], formatLroMetadata: () => "" };

it("renders LLM prompt templates, model metadata, and slots", async () => {
  const root = document.createElement("div");
  await renderPanel({ wasm, root, descriptor: create(PanelDescriptorSchema, {
    title: "Prompt", body: { case: "llmPrompt", value: create(LlmPromptPanelSchema, {
      description: "Greeting", systemTemplate: "You are helpful.", userTemplate: "Hello {{name}}",
      modelHint: { provider: "openai", model: "gpt-test" }, slots: [{ name: "name", field: { label: "Name" } }],
    }) },
  }), invoker: { invoke: async () => ({}) }, context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} } });
  expect(root.textContent).toContain("openai / gpt-test");
  expect(root.textContent).toContain("Hello {{name}}");
  expect(root.textContent).toContain("Name");
});
