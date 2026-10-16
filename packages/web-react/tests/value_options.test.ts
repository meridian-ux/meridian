// @vitest-environment jsdom
import { toBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { OPTION_INPUT_CASES, OPTION_INPUT_VALUES } from "../../../schemas/conformance/value_option_cases.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { OPTION_CONSTRAINED_CASES, OPTION_READ_CASES, OPTION_VALUES } from "../../../schemas/conformance/value_option_cases.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { ViewRenderer } from "../src/view_renderer.js";

// Inject only the clock boundary: undefined simulates SSR/first paint, and the
// corpus supplies explicit instants for mounted labels. The real hook's
// hydration lifecycle has separate coverage; formatting/rendering are real.
const clock = vi.hoisted(() => ({ now: undefined as number | undefined }));
vi.mock("../src/display_now.js", () => ({ useDisplayNow: () => clock.now }));

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
it("covers every representable no-clock scalar option as a typed default", () => {
  expect(OPTION_INPUT_VALUES).toHaveLength(217);
  expect(OPTION_INPUT_CASES).toHaveLength(1265);
});
for (const kit of [htmlKit, shadcnKit]) it.each(OPTION_INPUT_CASES)(`${kit.id} input: $name`, async fixture => {
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
      expect(container.querySelector('button[type="submit"]')).toBeNull();
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
it("covers every clocked and no-clock formatter case through each unrestricted read surface", () => {
  expect(OPTION_VALUES).toHaveLength(353);
  expect(OPTION_READ_CASES).toHaveLength(1765);
});

it("keeps every applicable string and numeric option case in constrained surfaces", () => {
  expect(OPTION_CONSTRAINED_CASES).toHaveLength(757);
});
for (const kit of [htmlKit, shadcnKit]) it.each(OPTION_CONSTRAINED_CASES)(`${kit.id} constrained: $name`, async fixture => {
  const container = document.createElement("main");
  document.body.append(container);
  const root = createRoot(container);
  const invoke = vi.fn(async () => ({}));
  try {
    await act(async () => root.render(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      children: createElement(ViewRenderer, { view: fixture.view }) })));
    if (fixture.arm === "stat") expect(container.textContent).toContain(fixture.expectedText);
    else {
      const copy = container.querySelector<HTMLButtonElement>("button[data-copy]")!;
      expect(copy).not.toBeNull();
      expect(copy.textContent).toBe(fixture.secret ? "••••••••" : fixture.expectedText);
      expect(copy.dataset.copy).toBe(fixture.raw);
      expect(copy.querySelector("a")).toBeNull();
      if (fixture.secret) {
        const plain = container.querySelector<HTMLElement>("[data-plain]")!;
        expect(plain.hidden).toBe(true);
        expect(plain.textContent).toBe(fixture.expectedText);
        expect(container.querySelector("[data-reveal]")?.getAttribute("aria-pressed")).toBe("false");
      }
      // Reference-kit data attributes are host-owned copy/reveal instructions;
      // do not silently add a second clipboard handler to this existing tier.
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(toBinary(ViewDescriptorSchema, fixture.view)).toEqual(fixture.bytes);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
for (const kit of [htmlKit, shadcnKit]) it.each(OPTION_READ_CASES)(`${kit.id}: $name`, async fixture => {
  clock.now = fixture.nowMs;
  const container = document.createElement("main");
  document.body.append(container);
  const root = createRoot(container);
  const raw = JSON.stringify(fixture.response);
  const invoke = vi.fn(async () => fixture.response);
  try {
    await act(async () => root.render(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
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
