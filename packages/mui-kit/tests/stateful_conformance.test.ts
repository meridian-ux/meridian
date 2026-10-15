import { create, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StreamFrameSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { MeridianProvider, ViewRenderer } from "@savvifi/meridian-web-react";
import { STATE_CASES } from "../../../schemas/conformance/state_cases.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";
import { muiKit } from "../src/mui_kit.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
describe("MUI stateful ViewDescriptor corpus", () => {
  it.each(STATE_CASES)("$name", async fixture => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const panelId = fixture.view.slots[0].panel!.panelId;
    const frames = (fixture.responses.__streamFrames ?? []) as object[];
    const invoke = vi.fn(async (service: string, method: string) =>
      (fixture.responses[`${service}.${method}`] ?? {}) as object);
    const onPromptResponse = vi.fn();
    try {
      await act(async () => root.render(createElement(MeridianProvider, {
        kit: muiKit, adhoc: {}, invoker: { invoke }, onPromptResponse, streamSnapshots: { [panelId]: frames.map(frame =>
          create(StreamFrameSchema, { dataJson: new TextEncoder().encode(JSON.stringify(frame)) })) },
        children: createElement(ViewRenderer, { view: fixture.view }),
      })));
      const tree = normalizeDom(container);
      expect(container.textContent).toContain(fixture.view.title);
      for (const call of Object.keys(fixture.responses).filter(key => !key.startsWith("__"))) {
        expect(invoke.mock.calls.some(([service, method]) => `${service}.${method}` === call), `${fixture.name} must consume ${call}`).toBe(true);
      }
      if (fixture.arm === "table" && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Member 00");
      if (fixture.arm === "table" && fixture.state === "empty") expect(tree).not.toContain("Member 00");
      if (fixture.expectedValue !== undefined) {
        if (fixture.arm === "table") expect(container.querySelector("tbody td")?.textContent).toBe(fixture.expectedValue);
        else expect(container.textContent).toContain(fixture.expectedValue);
        const slots = fixture.arm === "gallery" ? 3 : fixture.arm === "resource_cards" ? 4 : 1;
        expect((container.textContent ?? "").split(fixture.expectedValue).length - 1).toBeGreaterThanOrEqual(slots);
      }
      if (typeof fixture.typedRaw === "string") {
        const chip = container.querySelector<HTMLElement>(".MuiChip-root[role=button]");
        expect(chip?.textContent).toBe(fixture.expectedValue);
        const prior = Object.getOwnPropertyDescriptor(navigator, "clipboard");
        const writeText = vi.fn(async (_value: string) => {});
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
        try {
          await act(async () => chip!.click());
          expect(writeText).toHaveBeenCalledWith(fixture.typedRaw);
        } finally {
          if (prior) Object.defineProperty(navigator, "clipboard", prior);
          else Reflect.deleteProperty(navigator, "clipboard");
        }
      }
      if (["gallery", "resource_cards"].includes(fixture.arm) && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Resource 00");
      if (fixture.arm === "detail_header" && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Fixture record");
      if (fixture.arm === "form" && fixture.state !== "empty") expect(tree).toContain("Section 0");
      if (fixture.arm === "chart" && fixture.state !== "empty") expect(tree).toContain("2026-10-01");
      if (fixture.arm === "connect_flow" && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("~/.cursor/mcp.json");
      if (fixture.arm === "stream" && fixture.state === "overflow") {
        expect(tree).toContain("Stream line 139");
        expect(tree).not.toContain("Stream line 000");
      }
      expect(tree).toMatchSnapshot(`mui-kit/${fixture.name}`);
      if (fixture.arm === "prompt") {
        const body = fixture.view.slots[0].panel!.body; if (body.case !== "prompt" || body.value.fields[0].kind.case !== "text") throw new Error("Typed prompt fixture required");
        const raw = body.value.fields[0].kind.value.defaultValue;
        expect(container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe(raw);
        await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        expect(onPromptResponse).toHaveBeenCalledTimes(1); expect(onPromptResponse.mock.calls[0][0]).toBe(panelId);
        expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ reason: raw });
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
