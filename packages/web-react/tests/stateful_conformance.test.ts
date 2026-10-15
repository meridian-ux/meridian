// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StreamFrameSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { STATE_CASES } from "../../../schemas/conformance/state_cases.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { ViewRenderer } from "../src/view_renderer.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} stateful ViewDescriptor corpus`, () => {
  it.each(STATE_CASES)("$name", async (fixture) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const frames = (fixture.responses.__streamFrames ?? []) as object[];
    const panelId = fixture.view.slots[0].panel!.panelId;
    const invoke = vi.fn(async (service: string, method: string) =>
      (fixture.responses[`${service}.${method}`] ?? {}) as object);
    try {
      await act(async () => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, invoker: { invoke }, streamSnapshots: { [panelId]: frames.map(frame =>
          create(StreamFrameSchema, { dataJson: new TextEncoder().encode(JSON.stringify(frame)) })) },
        children: createElement(ViewRenderer, { view: fixture.view }),
      })));
      const tree = normalizeDom(container);
      expect(container.textContent).toContain(fixture.view.title);
      if (fixture.arm === "table" && ["typical", "overflow"].includes(fixture.state)) {
        expect(container.textContent).toContain("Member 00");
        expect(invoke).toHaveBeenCalled();
      }
      if (fixture.arm === "table" && fixture.state === "empty") expect(container.textContent).not.toContain("Member 00");
      if (fixture.expectedValue !== undefined) expect(container.querySelector("tbody td")?.textContent).toBe(fixture.expectedValue);
      for (const call of Object.keys(fixture.responses).filter(key => !key.startsWith("__"))) {
        expect(invoke.mock.calls.some(([service, method]) => `${service}.${method}` === call), `${fixture.name} must consume ${call}`).toBe(true);
      }
      if (["gallery", "resource_cards"].includes(fixture.arm) && fixture.state !== "empty") expect(tree).toContain("Resource 00");
      if (fixture.arm === "detail_header" && fixture.state !== "empty") expect(tree).toContain("Fixture record");
      if (fixture.arm === "form" && fixture.state !== "empty") expect(tree).toContain("Section 0");
      if (fixture.arm === "chart" && fixture.state !== "empty") expect(tree).toContain("2026-10-01");
      if (fixture.arm === "connect_flow" && fixture.state !== "empty") expect(tree).toContain("~/.cursor/mcp.json");
      if (fixture.arm === "stream" && fixture.state === "overflow") {
        expect(container.textContent).toContain("Stream line 139");
        expect(container.textContent).not.toContain("Stream line 000");
      }
      expect(tree).toMatchSnapshot(`${kit.id}/${fixture.name}`);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
