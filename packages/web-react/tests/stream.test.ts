import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreamFrameSchema, StreamPanelSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";

const frame = (value: unknown) => create(StreamFrameSchema, { dataJson: new TextEncoder().encode(JSON.stringify(value)) });
for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} stream transcript`, () => {
  const render = (frames: ReturnType<typeof frame>[], options: { lineField?: string; maxLines?: number; maxBytes?: number } = {}, seedId = "log", panelId = "log") =>
    renderToStaticMarkup(createElement(MeridianProvider, {
      kit, invoker: { invoke: async () => ({}) }, adhoc: {}, streamSnapshots: { [seedId]: frames },
    }, createElement(PanelRenderer, { descriptor: create(PanelDescriptorSchema, {
      panelId, title: "Build log",
      body: { case: "stream", value: create(StreamPanelSchema, { placeholder: "Waiting for build", ...options }) },
    }) })));

  it("renders protobuf snapshot frames during SSR and retains only the tail", () => {
    const html = render([frame("oldest"), frame("middle"), frame("newest")], { maxLines: 2 });
    expect(html).toContain("middle\nnewest");
    expect(html).not.toContain("oldest");
    expect(html).not.toContain("Waiting for build");
    expect(html).toContain('role="log"');
    expect(html).toContain('tabindex="0"');
  });

  it("resolves structured line fields without reading inherited properties", () => {
    expect(render([frame({ event: { message: "structured line" } })], { lineField: "event.message" })).toContain("structured line");
    expect(render([frame({})], { lineField: "constructor.name" })).toContain("Waiting for build");
  });

  it("isolates panel snapshots and preserves the authored empty state", () => {
    expect(render([frame("another panel")], {}, "other")).toContain("Waiting for build");
    expect(render([], {})).toContain("Waiting for build");
    expect(render([], {}, "other", "__proto__")).toContain("Waiting for build");
    expect(render([], {}, "other", "constructor")).toContain("Waiting for build");
  });

  it("skips malformed events without hiding valid content and escapes markup", () => {
    const invalid = create(StreamFrameSchema, { dataJson: new Uint8Array([255]) });
    const html = render([invalid, frame("<script>alert(1)</script>")]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("stops at the descriptor byte ceiling without accepting later frames", () => {
    const html = render([frame("a"), frame("oversized"), frame("b")], { maxBytes: 3 });
    expect(html).toContain(">a</pre>");
    expect(html).not.toContain("oversized");
    expect(html).not.toContain("a\nb");
    expect(html).toContain("Payload limit exceeded");
  });
});
