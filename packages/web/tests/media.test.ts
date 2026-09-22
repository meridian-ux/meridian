// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { MediaKind, MediaPanelSchema } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";

const noWasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[], buildPopulateRequest: () => ({}), readPath: () => null,
  buildRequest: () => ({}), renderTablePanel: () => [] as RenderedRow[], formatLroMetadata: () => "",
};

describe("web-components MediaPanel", () => {
  it("renders native image, audio, and video elements with metadata", async () => {
    for (const [kind, tag] of [[MediaKind.IMAGE, "img"], [MediaKind.AUDIO, "audio"], [MediaKind.VIDEO, "video"]] as const) {
      const root = document.createElement("div");
      await renderPanel({
        wasm: noWasm, root,
        descriptor: create(PanelDescriptorSchema, {
          title: "Media",
          body: { case: "media", value: create(MediaPanelSchema, {
            kind, srcUri: `${tag}.asset`, posterUri: "poster.png", alt: `An ${tag}`,
            captionsUri: "captions.vtt", durationMs: 125000, caption: "Preview",
            chapters: [{ startMs: 0, label: "Intro" }],
          }) },
        }),
        invoker: { invoke: async () => ({}) },
        context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
      });
      expect(root.querySelector(tag)?.getAttribute("src")).toBe(`${tag}.asset`);
      expect(root.textContent).toContain("Preview · 2:05");
      expect(root.textContent).toContain("Intro");
      if (tag === "video") expect(root.querySelector("track")?.getAttribute("src")).toBe("captions.vtt");
    }
  });

  it("renders chapter offsets as seek controls and seeks the active player", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: noWasm, root,
      descriptor: create(PanelDescriptorSchema, {
        title: "Chaptered video",
        body: { case: "media", value: create(MediaPanelSchema, {
          kind: MediaKind.VIDEO,
          srcUri: "/walkthrough.mp4",
          chapters: [{ startMs: 65_500, label: "Add the sponsor" }],
        }) },
      }),
      invoker: { invoke: async () => ({}) },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });

    const video = root.querySelector("video")!;
    const seek = root.querySelector<HTMLButtonElement>('button[data-start-ms="65500"]')!;
    expect(seek.textContent).toBe("1:05 Add the sponsor");
    expect(seek.querySelector("time")?.getAttribute("datetime")).toBe("PT65.5S");
    seek.click();
    expect(video.currentTime).toBe(65.5);
  });

  it("degrades rejected media assets without mounting active sources", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: noWasm, root,
      descriptor: create(PanelDescriptorSchema, {
        title: "Unsafe media",
        body: { case: "media", value: create(MediaPanelSchema, {
          kind: MediaKind.VIDEO,
          srcUri: "javascript:alert(1)",
          posterUri: "data:image/png;base64,bad",
          captionsUri: "file:///tmp/captions.vtt",
          alt: "Rejected walkthrough",
        }) },
      }),
      invoker: { invoke: async () => ({}) },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });

    expect(root.querySelector("video, audio, img, track")).toBeNull();
    expect(root.querySelector("[data-media-kind=none]")?.textContent).toContain("Rejected walkthrough");
  });

  it("drops rejected poster and caption assets while retaining a safe player", async () => {
    const root = document.createElement("div");
    await renderPanel({
      wasm: noWasm, root,
      descriptor: create(PanelDescriptorSchema, {
        title: "Partially safe media",
        body: { case: "media", value: create(MediaPanelSchema, {
          kind: MediaKind.VIDEO,
          srcUri: "/walkthrough.mp4",
          posterUri: "javascript:alert(1)",
          captionsUri: "data:text/vtt,unsafe",
          alt: "Safe walkthrough",
        }) },
      }),
      invoker: { invoke: async () => ({}) },
      context: { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} },
    });

    expect(root.querySelector("video")?.getAttribute("src")).toBe("/walkthrough.mp4");
    expect(root.querySelector("video")?.hasAttribute("poster")).toBe(false);
    expect(root.querySelector("track")).toBeNull();
  });
});
