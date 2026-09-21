// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} step media`, () => {
  const view = (mediaUri: string, mediaAlt = "The sponsors list") => createElement(
    MeridianProvider, { kit, invoker: { invoke: async () => ({}) }, adhoc: {} },
    createElement(PanelRenderer, { descriptor: create(PanelDescriptorSchema, {
      panelId: "walkthrough", body: { case: "steps", value: {
        intro: "Start here", outro: "All done", steps: [
          { label: "Open Sponsors", detail: "Choose an employer", actor: "Admin", mediaUri, mediaAlt },
          { label: "Confirm the result" },
        ],
      } },
    }) }),
  );
  const markup = (uri: string, alt?: string) => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(view(uri, alt));
    return container;
  };

  it("renders relative and HTTP(S) frames with alternatives while preserving the ordered walkthrough", () => {
    for (const uri of ["/evidence/sponsors.png", "../frames/sponsors.png", "https://example.com/frame.png", "http://example.com/frame.png"]) {
      const container = markup(uri);
      const image = container.querySelector("img")!;
      expect(image.getAttribute("src")).toBe(uri);
      expect(image.alt).toBe("The sponsors list");
      expect(image.getAttribute("loading")).toBe("lazy");
      expect(container.querySelectorAll("ol > li")).toHaveLength(2);
      for (const text of ["Start here", "All done", "Admin", "Choose an employer", "Confirm the result"])
        expect(container.textContent).toContain(text);
      expect(container.textContent).not.toContain("The sponsors list");
    }
    expect(markup("/frame.png", "").querySelector("img")?.alt).toBe("Open Sponsors");
  });

  it("keeps alternatives readable for missing or invalid media without emitting unsafe image sources", () => {
    for (const uri of ["", " ", "javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,unsafe", "file:///frame.png", "https://[invalid"]) {
      const container = markup(uri);
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("The sponsors list");
      expect(container.textContent).toContain("Choose an employer");
    }
    expect(markup("", "").querySelector("img")).toBeNull();
  });

  it("degrades a failed frame to text and tries a replacement source on descriptor updates", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(view("/broken.png")));
      await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("The sponsors list");
      await act(async () => root.render(view("/replacement.png", "The corrected frame")));
      expect(container.querySelector("img")?.getAttribute("src")).toBe("/replacement.png");
      expect(container.querySelector("img")?.alt).toBe("The corrected frame");
    } finally { await act(async () => root.unmount()); }
  });
});
