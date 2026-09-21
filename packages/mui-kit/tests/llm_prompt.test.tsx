import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
    expect(screen.getByText("openai / gpt-test")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });
});
