// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { AffordanceStyle } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";

const noWasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[], buildPopulateRequest: () => ({}), readPath: () => null,
  buildRequest: () => ({}), renderTablePanel: () => [] as RenderedRow[], formatLroMetadata: () => "",
};

describe("web-components StepsPanel", () => {
  it("renders a nested step affordance without dropping its semantics", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: noWasm,
      root,
      descriptor: create(PanelDescriptorSchema, {
        title: "Deploy",
        body: {
          case: "steps",
          value: {
            steps: [{
              label: "Open the rollout",
              action: {
                label: "View deploys",
                description: "Watch the rollout",
                icon: "open",
                style: AffordanceStyle.PRIMARY,
                invoke: { case: "uri", value: "/deploys" },
              },
            }],
          },
        },
      }),
      invoker: { invoke: async () => ({}) },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });

    const action = root.querySelector<HTMLAnchorElement>('.mer-step a[href="/deploys"]');
    expect(action?.textContent).toContain("View deploys");
    expect(action?.title).toBe("Watch the rollout");
    expect(action?.dataset.icon).toBe("open");
    expect(root.querySelector(".mer-affordance-desc")?.textContent).toBe("Watch the rollout");
  });

  it("admits passive frame sources and degrades unsafe sources to text", async () => {
    for (const [mediaUri, admitted] of [
      ["/evidence/deploy.png", true],
      ["https://example.com/deploy.png", true],
      ["javascript:alert(1)", false],
      ["data:image/svg+xml,unsafe", false],
      ["file:///tmp/deploy.png", false],
    ] as const) {
      const root = document.createElement("div");
      await renderPanel({
        wasm: noWasm,
        root,
        descriptor: create(PanelDescriptorSchema, {
          body: { case: "steps", value: { steps: [{ label: "Deploy", mediaUri, mediaAlt: "Deployment screen" }] } },
        }),
        invoker: { invoke: async () => ({}) },
        context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
      });
      expect(!!root.querySelector("img")).toBe(admitted);
      expect(root.textContent).toContain("Deployment screen");
    }
  });
});
