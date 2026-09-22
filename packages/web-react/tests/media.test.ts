// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MediaKind, MediaPanelSchema } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";

import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider } from "../src/provider.js";
import { shadcnKit } from "../src/shadcn_kit.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} media chapters`, () => {
  it("preserves chapter offsets and seeks the active player", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(
        MeridianProvider,
        { kit, invoker: { invoke: async () => ({}) }, adhoc: {} },
        createElement(PanelRenderer, { descriptor: create(PanelDescriptorSchema, {
          panelId: "chaptered",
          body: { case: "media", value: create(MediaPanelSchema, {
            kind: MediaKind.VIDEO,
            srcUri: "/walkthrough.mp4",
            chapters: [{ startMs: 65_500, label: "Add the sponsor" }],
          }) },
        }) }),
      )));

      const video = container.querySelector("video")!;
      const seek = container.querySelector<HTMLButtonElement>('button[data-start-ms="65500"]')!;
      expect(seek.textContent).toContain("1:05 Add the sponsor");
      expect(seek.querySelector("time")?.getAttribute("datetime")).toBe("PT65.5S");
      await act(async () => seek.click());
      expect(video.currentTime).toBe(65.5);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
