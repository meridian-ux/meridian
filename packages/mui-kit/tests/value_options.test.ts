import { toBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { FORM_DEFAULT_BUDGET_CASES } from "../../../schemas/conformance/value_option_cases.js";
import { OPTION_INPUT_CASES, OPTION_INPUT_VALUES } from "../../../schemas/conformance/value_option_cases.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { OPTION_CONSTRAINED_CASES, OPTION_READ_CASES } from "../../../schemas/conformance/value_option_cases.js";
import { MeridianProvider, ViewRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";

// Inject the explicit clock boundary, not the formatter. Undefined simulates
// SSR/first paint; mounted hydration behavior is tested separately.
const clock = vi.hoisted(() => ({ now: undefined as number | undefined }));
vi.mock("../src/use_display_now.js", () => ({ useDisplayNow: () => clock.now }));

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
for (const kit of [muiKit]) it.each(FORM_DEFAULT_BUDGET_CASES)(`${kit.id} bounded defaults: $name`, async fixture => {
  const container = document.createElement("main"); document.body.append(container);
  const root = createRoot(container), invoke = vi.fn(async () => ({})), onPromptResponse = vi.fn();
  const nativeFrom = Array.from;
  const allocation = vi.spyOn(Array, "from").mockImplementation((source: any, map?: any, receiver?: any) => {
    if (source && !source[Symbol.iterator] && source.length > 1000) throw new Error("unbounded allocation sentinel");
    return nativeFrom(source, map, receiver);
  });
  try {
    await act(async () => root.render(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke }, onPromptResponse,
      admission: { mutations: ["fixture.Inputs/Submit", "fixture.Inputs/Start"] },
      children: createElement(ViewRenderer, { view: fixture.view }) })));
    expect(container.textContent).toContain(fixture.reason);
    expect(container.querySelectorAll("input,select,textarea")).toHaveLength(0);
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      for (const button of container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) {
        expect(button.disabled).toBe(true); button.click();
      }
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(onPromptResponse).not.toHaveBeenCalled();
    expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(fixture.bytes);
  } finally { allocation.mockRestore(); await act(async () => root.unmount()); container.remove(); }
});
it("covers every representable no-clock scalar option as a typed default", () => {
  expect(OPTION_INPUT_VALUES).toHaveLength(217);
  expect(OPTION_INPUT_CASES).toHaveLength(1265);
});
for (const kit of [muiKit]) it.each(OPTION_INPUT_CASES)(`${kit.id} input: $name`, async fixture => {
  clock.now = undefined;
  const container = document.createElement("main");
  document.body.append(container);
  const root = createRoot(container);
  const invoke = vi.fn(async () => ({ name: "operations/fixture", done: true, response: {} }));
  const onPromptResponse = vi.fn();
  try {
    await act(async () => root.render(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      onPromptResponse, admission: { mutations: ["fixture.Inputs/Submit", "fixture.Inputs/Start"] },
      children: createElement(ViewRenderer, { view: fixture.view }) })));
    expect(invoke).not.toHaveBeenCalled();
    if (fixture.surface === "readonlyForm") {
      const shown = container.querySelector("[data-field], [data-field-display]");
      expect(shown?.textContent).toBe(fixture.expected.text);
      expect(shown?.getAttribute("title") ?? undefined).toBe(fixture.expected.title);
      for (const button of container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) expect(button.disabled).toBe(true);
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      expect(invoke).not.toHaveBeenCalled();
    } else {
      const control = container.querySelector<HTMLInputElement>("textarea,input:not([type=hidden])");
      expect(control, "editable scalar default must exist").not.toBeNull();
      if (typeof fixture.raw === "number") expect(Number(control!.value)).toBe(fixture.raw);
      else expect(control!.value).toBe(fixture.raw);
      await act(async () => {
        if (fixture.surface === "lro") {
          const run = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === "Run");
          expect(run).toBeDefined(); run!.click();
        } else container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      if (fixture.surface === "prompt") {
        expect(onPromptResponse).toHaveBeenCalledTimes(1);
        expect(toJson(StructSchema, onPromptResponse.mock.calls[0][1])).toEqual({ value: fixture.raw });
        expect(invoke).not.toHaveBeenCalled();
      } else if (fixture.surface === "llmPrompt") {
        expect(container.querySelector('[aria-label="User prompt"] pre')?.textContent)
          .toBe(`Value=${typeof fixture.raw === "string" ? fixture.raw : JSON.stringify(fixture.raw)}`);
        expect(invoke).not.toHaveBeenCalled();
      } else {
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("fixture.Inputs", fixture.surface === "lro" ? "Start" : "Submit", { value: fixture.raw });
      }
    }
    expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(fixture.bytes);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
it.each(OPTION_READ_CASES)("MUI: $name", async fixture => {
  clock.now = fixture.nowMs;
  const container = document.createElement("main");
  document.body.append(container);
  const root = createRoot(container);
  const raw = JSON.stringify(fixture.response);
  const invoke = vi.fn(async () => fixture.response);
  try {
    await act(async () => root.render(createElement(MeridianProvider, { kit: muiKit, adhoc: {}, invoker: { invoke },
      children: createElement(ViewRenderer, { view: fixture.view }) })));
    expect(invoke).toHaveBeenCalledWith("fixture.Options", "Get", expect.anything());
    if (fixture.arm === "table") expect(container.querySelector("tbody td")?.textContent).toBe(fixture.expected.text);
    else expect(container.textContent).toContain(fixture.expected.text);
    const slots = fixture.arm === "gallery" ? 3 : fixture.arm === "resourceCards" ? 4 : 1;
    expect((container.textContent ?? "").split(fixture.expected.text).length - 1).toBeGreaterThanOrEqual(slots);
    if (fixture.expected.title !== undefined) {
      expect([...container.querySelectorAll("[title]")].filter(node => node.getAttribute("title") === fixture.expected.title).length).toBeGreaterThanOrEqual(slots);
    }
    expect(JSON.stringify(fixture.response)).toBe(raw);
    expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(fixture.bytes);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it.each(OPTION_CONSTRAINED_CASES)("MUI constrained: $name", async fixture => {
  const container = document.createElement("main");
  document.body.append(container);
  const root = createRoot(container);
  const invoke = vi.fn(async () => ({}));
  const prior = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    await act(async () => root.render(createElement(MeridianProvider, { kit: muiKit, adhoc: {}, invoker: { invoke },
      children: createElement(ViewRenderer, { view: fixture.view }) })));
    expect(writeText).not.toHaveBeenCalled();
    if (fixture.arm === "stat") expect(container.querySelector(".mer-stat-value")?.textContent).toBe(fixture.expectedText);
    else {
      const copy = container.querySelector<HTMLElement>(".MuiChip-root[role=button]")!;
      expect(copy.textContent).toBe(fixture.secret ? "••••••••" : fixture.expectedText);
      expect(copy.querySelector("a")).toBeNull();
      await act(async () => copy.click());
      expect(writeText).toHaveBeenCalledWith(fixture.raw);
      expect(writeText).toHaveBeenCalledOnce();
      if (fixture.secret) {
        const reveal = container.querySelector<HTMLButtonElement>(".mer-reveal")!;
        await act(async () => reveal.click());
        expect(reveal.getAttribute("aria-pressed")).toBe("true");
        expect(copy.textContent).toBe(fixture.expectedText);
        await act(async () => reveal.click());
        expect(reveal.getAttribute("aria-pressed")).toBe("false");
        expect(copy.textContent).toBe("••••••••");
        expect(writeText).toHaveBeenCalledOnce();
      }
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(fixture.bytes);
  } finally {
    await act(async () => root.unmount()); container.remove();
    if (prior) Object.defineProperty(navigator, "clipboard", prior);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
