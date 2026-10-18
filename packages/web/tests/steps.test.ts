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
  const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
  const draw = async (root: HTMLElement, mediaUri: string, mediaAlt = "Frame summary", detail = "Narration") => renderPanel({
    root, wasm: noWasm, context, invoker: { invoke: async () => ({}) },
    descriptor: create(PanelDescriptorSchema, { body: { case: "steps", value: {
      intro: "Start here", outro: "Finish here", steps: [
        { label: "First", actor: "Admin", mediaUri, mediaAlt, detail, action: { label: "Continue", invoke: { case: "uri", value: "/next" } } },
        { label: "Second", actor: "Reviewer", detail: "Review the result" },
      ],
    } } }),
  });

  it("uses one ordered list in descriptor order with independent intro, narration, actors, actions, and outro", async () => {
    const root = document.createElement("div"); await draw(root, "/frame.png");
    expect(root.querySelectorAll(".mer-steps > ol")).toHaveLength(1);
    expect([...root.querySelectorAll(".mer-steps > ol > li .mer-step-label")].map(node => node.textContent)).toEqual(["First (Admin)", "Second (Reviewer)"]);
    for (const text of ["Start here", "Finish here", "Narration", "Review the result"]) expect(root.textContent).toContain(text);
    expect(root.querySelector("a[href]")).toBeNull();
    expect(root.querySelector("button.mer-affordance")!.textContent).toBe("Continue");
    expect(root.querySelector("img")!.alt).toBe("Frame summary");
  });

  it("preserves both narration and a distinct alternative after frame failure without duplicating repeated errors", async () => {
    const root = document.createElement("div"); await draw(root, "/broken.png");
    const image = root.querySelector("img")!; expect(root.textContent).not.toContain("Frame summary");
    image.dispatchEvent(new Event("error")); image.dispatchEvent(new Event("error"));
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".mer-step-detail")!.textContent).toBe("Narration");
    expect(root.querySelectorAll(".mer-step-media-alt")).toHaveLength(1);
    expect(root.querySelector(".mer-step-media-alt")!.textContent).toBe("Frame summary");
    expect(root.querySelectorAll("ol > li")).toHaveLength(2); expect(root.querySelector("button.mer-affordance")!.textContent).toBe("Continue");
    await draw(root, "/replacement.png", "Replacement summary");
    image.dispatchEvent(new Event("error"));
    expect(root.textContent).not.toContain("Frame summary"); expect(root.querySelector("img")!.getAttribute("src")).toBe("/replacement.png");
  });

  it("retains distinct alternatives for absent or rejected frames and deduplicates identical narration", async () => {
    const root = document.createElement("div");
    for (const uri of ["", "javascript:alert(1)", "data:text/html,unsafe", "file:///frame.png"]) {
      await draw(root, uri); expect(root.querySelector("img")).toBeNull();
      expect(root.textContent).toContain("Narration"); expect(root.textContent).toContain("Frame summary");
    }
    await draw(root, "", "Same text", "Same text");
    expect([...root.querySelectorAll("li:first-child p")].map(node => node.textContent)).toEqual(["Same text"]);
  });
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

    const action = root.querySelector<HTMLButtonElement>('.mer-step button.mer-affordance');
    expect(root.querySelector('a[href="/deploys"]')).toBeNull();
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
