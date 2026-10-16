import { toBinary } from "@bufbuild/protobuf";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { OPTION_READ_CASES } from "../../../schemas/conformance/value_option_cases.js";
import { MeridianProvider, ViewRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";

// Inject the explicit clock boundary, not the formatter. Undefined simulates
// SSR/first paint; mounted hydration behavior is tested separately.
const clock = vi.hoisted(() => ({ now: undefined as number | undefined }));
vi.mock("../src/use_display_now.js", () => ({ useDisplayNow: () => clock.now }));

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
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
