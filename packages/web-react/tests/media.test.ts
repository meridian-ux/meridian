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
import { resolveMediaKind } from "@savvifi/meridian-schemas/uiview";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

it("resolves declared media or recognized source extensions without guessing unknown sources", () => {
  for (const [source, kind] of [["/IMAGE.PNG?size=2", MediaKind.IMAGE], ["https://example.com/audio.MP3#t=1", MediaKind.AUDIO], ["/movie.webm", MediaKind.VIDEO], ["/unknown.asset", MediaKind.UNSPECIFIED], ["javascript:alert(1).mp4", MediaKind.UNSPECIFIED]] as const)
    expect(resolveMediaKind(MediaKind.UNSPECIFIED, source)).toBe(kind);
  expect(resolveMediaKind(MediaKind.AUDIO, "/opaque.asset")).toBe(MediaKind.AUDIO);
});

for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} media chapters`, () => {
  const view = (srcUri = "/movie.mp4", kind = MediaKind.VIDEO, posterUri = "/poster.png") => createElement(MeridianProvider,
    { kit, invoker: { invoke: vi.fn() }, adhoc: {} }, createElement(PanelRenderer, { descriptor: create(PanelDescriptorSchema, {
      panelId: "fallback", body: { case: "media", value: { kind, srcUri, posterUri, alt: "Media summary", caption: "A caption", durationMs: 65000,
        captionsUri: "/captions.vtt", chapters: [{ startMs: 1000, label: "First chapter" }] } },
    }) }));

  it("degrades video and audio errors to poster then alt without losing metadata or source", async () => {
    const container = document.createElement("div"), root = createRoot(container);
    try {
      for (const kind of [MediaKind.VIDEO, MediaKind.AUDIO]) {
        await act(async () => root.render(view(`/movie-${kind}.asset`, kind)));
        const player = container.querySelector("video, audio")!;
        if (player.querySelector("track")) {
          await act(async () => player.querySelector("track")!.dispatchEvent(new Event("error", { bubbles: true })));
          expect(container.querySelector("video, audio")).toBe(player);
        }
        await act(async () => player.dispatchEvent(new Event("error")));
        expect(container.querySelector("video, audio")).toBeNull();
        expect(container.querySelector("img")!.getAttribute("src")).toBe("/poster.png");
        expect(container.querySelector<HTMLButtonElement>("button[data-start-ms]")!.disabled).toBe(true);
        expect(container.querySelector("a")!.getAttribute("href")).toBe(`/movie-${kind}.asset`);
        await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
        expect(container.querySelector("img")).toBeNull();
        for (const text of ["Media summary", "A caption", "65s", "First chapter"]) expect(container.textContent).toContain(text);
      }
    } finally { await act(async () => root.unmount()); }
  });
  it("uses a safe poster for rejected sources and never links rejected URLs", async () => {
    const container = document.createElement("div"), root = createRoot(container);
    try {
      await act(async () => root.render(view("javascript:alert(1)")));
      expect(container.querySelector("video, audio, track, a")).toBeNull(); expect(container.querySelector("img")!.getAttribute("src")).toBe("/poster.png");
      await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(container.textContent).toContain("Media summary");
      await act(async () => root.render(view("/fresh.mp4")));
      expect(container.querySelector("video")!.getAttribute("src")).toBe("/fresh.mp4");
    } finally { await act(async () => root.unmount()); }
  });
  it("does not use an IMAGE poster and reports seek exceptions without crashing", async () => {
    const container = document.createElement("div"), root = createRoot(container);
    try {
      await act(async () => root.render(view("/image.png", MediaKind.IMAGE)));
      await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(container.querySelector("img")).toBeNull(); expect(container.textContent).toContain("Media summary");
      await act(async () => root.render(view("/seek.mp4")));
      Object.defineProperty(container.querySelector("video")!, "currentTime", { set() { throw new Error("not seekable"); } });
      await act(async () => container.querySelector<HTMLButtonElement>("button[data-start-ms]")!.click());
      expect(container.querySelector('[role="status"]')!.textContent).toBe("Seeking is unavailable.");
    } finally { await act(async () => root.unmount()); }
  });
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

  it("degrades rejected media assets without mounting active sources", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(
        MeridianProvider,
        { kit, invoker: { invoke: async () => ({}) }, adhoc: {} },
        createElement(PanelRenderer, { descriptor: create(PanelDescriptorSchema, {
          panelId: "unsafe-media",
          body: { case: "media", value: create(MediaPanelSchema, {
            kind: MediaKind.VIDEO,
            srcUri: "javascript:alert(1)",
            posterUri: "data:image/png;base64,bad",
            captionsUri: "file:///tmp/captions.vtt",
            alt: "Rejected walkthrough",
          }) },
        }) }),
      )));

      expect(container.querySelector("video, audio, img, track")).toBeNull();
      expect(container.querySelector("[data-media-kind=none]")?.textContent).toContain("Rejected walkthrough");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("drops rejected poster and caption assets while retaining a safe player", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(
        MeridianProvider,
        { kit, invoker: { invoke: async () => ({}) }, adhoc: {} },
        createElement(PanelRenderer, { descriptor: create(PanelDescriptorSchema, {
          panelId: "partially-safe-media",
          body: { case: "media", value: create(MediaPanelSchema, {
            kind: MediaKind.VIDEO,
            srcUri: "/walkthrough.mp4",
            posterUri: "javascript:alert(1)",
            captionsUri: "data:text/vtt,unsafe",
            alt: "Safe walkthrough",
          }) },
        }) }),
      )));

      expect(container.querySelector("video")?.getAttribute("src")).toBe("/walkthrough.mp4");
      expect(container.querySelector("video")?.hasAttribute("poster")).toBe(false);
      expect(container.querySelector("track")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
