// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PrincipalDisplay, TemporalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { MeridianRecordContext } from "../src/pagination.js";
import { PanelRenderer } from "../src/panel_renderer.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

describe.each([htmlKit, shadcnKit])("$id default Rust formatter hydration", kit => {
  it("hydrates real populated fields without replacing SSR markup or leaking host formatting", async () => {
    const descriptor = create(PanelDescriptorSchema, { panelId: "hydration", body: { case: "detailHeader", value: {
      title: "Hydrated record", descriptorRows: [
        { label: "Posted", sourcePath: "posted", display: { type: ValueType.DATE_TIME,
          options: { case: "temporal", value: { display: TemporalDisplay.RELATIVE_WITH_ABSOLUTE_TITLE } } } },
        { label: "Owner", sourcePath: "owner", display: { type: ValueType.PRINCIPAL,
          options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
      ],
    } } });
    const invoke = vi.fn(async () => ({}));
    const tree = createElement(MeridianProvider, { kit, invoker: { invoke }, adhoc: {}, children:
      createElement(MeridianRecordContext.Provider, { value: {
        posted: "2026-03-29T13:45:00Z", owner: "Ada <ada@example.com>",
      }, children: createElement(PanelRenderer, { descriptor }) }),
    });
    const server = renderToString(tree);
    expect(server).toContain("Mar 29, 2026, 1:45 PM UTC");
    const container = document.createElement("div");
    container.innerHTML = server;
    document.body.append(container);
    const originalHeader = container.querySelector("header");
    const recoverable: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: error => recoverable.push(error) }); });
      expect(recoverable).toEqual([]);
      expect(container.querySelector("header")).toBe(originalHeader);
      expect(container.querySelector('[title="Mar 29, 2026, 1:45 PM UTC"]')).not.toBeNull();
      expect(container.querySelector('[title="ada@example.com"]')?.textContent).toBe("Ada");
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      if (root) await act(async () => root!.unmount());
      container.remove();
    }
  });
});
