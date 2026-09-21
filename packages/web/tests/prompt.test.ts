// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { FormFieldSchema, TextInputSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
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
