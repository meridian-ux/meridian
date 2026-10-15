// @vitest-environment jsdom
import { create, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
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
    const invoke = vi.fn(async (service: string, method: string, _request: unknown) =>
      service === "fixture.Inputs" && method === "Start" ? { name: "operations/fixture", done: true, response: {} }
      : (fixture.responses[`${service}.${method}`] ?? {}) as object);
    const onPromptResponse = vi.fn();
    try {
      await act(async () => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, invoker: { invoke }, onPromptResponse,
        admission: { mutations: ["fixture.Inputs/Submit", "fixture.Inputs/Start"] }, streamSnapshots: { [panelId]: frames.map(frame =>
          create(StreamFrameSchema, { dataJson: new TextEncoder().encode(JSON.stringify(frame)) })) },
        children: createElement(ViewRenderer, { view: fixture.view }),
      })));
      const tree = normalizeDom(container);
      expect(container.textContent).toContain(fixture.view.title);
      if (fixture.input) {
        const input = fixture.input;
        if (input.readonly) {
          if (input.masked) expect(container.textContent).not.toContain(String(input.raw));
          else expect((container.textContent ?? "").includes(input.expectedRead) || [...container.querySelectorAll<HTMLInputElement>("input,textarea,select")].some(control => control.value === input.expectedRead)).toBe(true);
        } else {
          if (typeof input.raw === "string" || typeof input.raw === "number") {
            const control = container.querySelector<HTMLInputElement>("select,textarea,input:not([type=hidden])");
            expect(control, "declared scalar input must exist").not.toBeNull();
            expect(control!.value).toBe(String(input.raw));
          } else if (typeof input.raw === "boolean") expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(input.raw);
          await act(async () => {
            if (fixture.arm === "lro") {
              const run = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Run");
              expect(run, "LRO must expose its run gesture").toBeDefined(); run!.click();
            } else {
              expect(container.querySelector("form"), "input surface must collect values").not.toBeNull();
              container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            }
          });
          if (fixture.arm === "prompt") {
            expect(onPromptResponse).toHaveBeenCalledTimes(1);
            expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ value: input.raw });
          } else if (fixture.arm === "llm_prompt") {
            const preview = container.querySelector('[aria-label="User prompt"] pre')!.textContent ?? "";
            if (input.masked) { expect(preview).not.toContain(String(input.raw)); expect(preview).not.toContain("{{value}}"); }
            else expect(preview).toBe(`Value=${typeof input.raw === "string" ? input.raw : JSON.stringify(input.raw)}`);
            expect(invoke).not.toHaveBeenCalled();
          } else expect(invoke).toHaveBeenCalledWith("fixture.Inputs", fixture.arm === "lro" ? "Start" : "Submit", { value: input.raw });
        }
        expect(tree).toMatchSnapshot(`${kit.id}/${fixture.name}`);
        return;
      }
      if (fixture.arm === "table" && ["typical", "overflow"].includes(fixture.state)) {
        expect(container.textContent).toContain("Member 00");
        expect(invoke).toHaveBeenCalled();
      }
      if (fixture.arm === "table" && fixture.state === "empty") expect(container.textContent).not.toContain("Member 00");
      if (fixture.expectedValue !== undefined) {
        if (fixture.arm === "table") expect(container.querySelector("tbody td")?.textContent).toBe(fixture.expectedValue);
        else expect(container.textContent).toContain(fixture.expectedValue);
        const slots = fixture.arm === "gallery" ? 3 : fixture.arm === "resource_cards" ? 4 : 1;
        expect((container.textContent ?? "").split(fixture.expectedValue).length - 1).toBeGreaterThanOrEqual(slots);
      }
      if (typeof fixture.typedRaw === "string") {
        const button = container.querySelector<HTMLElement>("button[data-copy]");
        expect(button?.textContent).toBe(fixture.expectedValue);
        expect(button?.getAttribute("data-copy")).toBe(fixture.typedRaw);
        expect(button?.querySelector("a")).toBeNull();
      }
      for (const call of Object.keys(fixture.responses).filter(key => !key.startsWith("__"))) {
        expect(invoke.mock.calls.some(([service, method]) => `${service}.${method}` === call), `${fixture.name} must consume ${call}`).toBe(true);
      }
      if (["gallery", "resource_cards"].includes(fixture.arm) && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Resource 00");
      if (fixture.arm === "detail_header" && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("Fixture record");
      if (fixture.arm === "form" && fixture.state !== "empty") expect(tree).toContain("Section 0");
      if (fixture.arm === "chart" && fixture.state !== "empty") expect(tree).toContain("2026-10-01");
      if (fixture.arm === "connect_flow" && ["typical", "overflow"].includes(fixture.state)) expect(tree).toContain("~/.cursor/mcp.json");
      if (fixture.arm === "stream" && fixture.state === "overflow") {
        expect(container.textContent).toContain("Stream line 139");
        expect(container.textContent).not.toContain("Stream line 000");
      }
      expect(tree).toMatchSnapshot(`${kit.id}/${fixture.name}`);
      if (fixture.arm === "prompt") {
        const body = fixture.view.slots[0].panel!.body; if (body.case !== "prompt" || body.value.fields[0].kind.case !== "text") throw new Error("Typed prompt fixture required");
        const raw = body.value.fields[0].kind.value.defaultValue;
        expect(container.querySelector<HTMLInputElement>('[name="reason"]')!.value).toBe(raw);
        await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
        expect(onPromptResponse).toHaveBeenCalledTimes(1); expect(onPromptResponse.mock.calls[0][0]).toBe(panelId);
        expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ reason: raw });
      }
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
