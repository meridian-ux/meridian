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
});
