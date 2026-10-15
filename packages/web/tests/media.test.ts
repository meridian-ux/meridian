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
  const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
  const fallback = async (root: HTMLElement, kind = MediaKind.VIDEO, srcUri = "/movie.asset", posterUri = "/poster.png") => renderPanel({
    root, wasm: noWasm, context, invoker: { invoke: async () => ({}) }, descriptor: create(PanelDescriptorSchema, {
      panelId: "fallback", body: { case: "media", value: { kind, srcUri, posterUri, captionsUri: "/captions.vtt", alt: "Media summary", caption: "A caption", durationMs: 65000, chapters: [{ startMs: 1000, label: "First chapter" }] } },
    }),
  });
  it("degrades video/audio errors to poster then alt, retaining metadata and ignoring stale errors", async () => {
    for (const kind of [MediaKind.VIDEO, MediaKind.AUDIO]) {
      const root = document.createElement("div"); await fallback(root, kind);
      const player = root.querySelector("video, audio")!;
      player.querySelector("track")?.dispatchEvent(new Event("error", { bubbles: true }));
      expect(root.querySelector("video, audio")).toBe(player);
      player.dispatchEvent(new Event("error"));
      const poster = root.querySelector("img")!; expect(poster.getAttribute("src")).toBe("/poster.png");
      player.dispatchEvent(new Event("error")); expect(root.querySelector("img")).toBe(poster);
      expect(root.querySelector<HTMLButtonElement>("button[data-start-ms]")!.disabled).toBe(true);
      expect(root.querySelector("a")!.getAttribute("href")).toBe("/movie.asset");
      poster.dispatchEvent(new Event("error")); expect(root.querySelector("video, audio, img")).toBeNull();
      for (const text of ["Media summary", "A caption", "1:05", "First chapter"]) expect(root.textContent).toContain(text);
      await fallback(root, kind, "/fresh.asset"); expect(root.querySelector("video, audio")!.getAttribute("src")).toBe("/fresh.asset");
    }
  });
  it("uses safe posters for missing/rejected sources, never links rejected URLs, and ignores IMAGE posters", async () => {
    const root = document.createElement("div");
    for (const source of ["", "javascript:alert(1)"]) {
      await fallback(root, MediaKind.VIDEO, source);
      expect(root.querySelector("video, audio, track, a")).toBeNull(); expect(root.querySelector("img")!.getAttribute("src")).toBe("/poster.png");
      root.querySelector("img")!.dispatchEvent(new Event("error")); expect(root.textContent).toContain("Media summary");
    }
    await fallback(root, MediaKind.IMAGE, "/picture.png"); root.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(root.querySelector("img")).toBeNull();
  });
  it("infers known extensions, degrades unknown media, and contains seek exceptions", async () => {
    const root = document.createElement("div"); await fallback(root, MediaKind.UNSPECIFIED, "/image.PNG?size=2");
    expect(root.querySelector("img")!.getAttribute("src")).toBe("/image.PNG?size=2");
    await fallback(root, MediaKind.UNSPECIFIED); expect(root.querySelector("video, audio")).toBeNull();
    await fallback(root);
    Object.defineProperty(root.querySelector("video")!, "currentTime", { set() { throw new Error("not seekable"); } });
    root.querySelector<HTMLButtonElement>("button[data-start-ms]")!.click();
    expect(root.querySelector('[role="status"]')!.textContent).toBe("Seeking is unavailable.");
  });
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
