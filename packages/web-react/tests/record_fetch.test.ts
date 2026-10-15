// @vitest-environment jsdom
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema, type PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FieldBindingSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { AdmissionPolicy, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianViewContext } from "../src/view_renderer.js";
import { MeridianInitialDataContext, MeridianRecordContext, MeridianSelectionContext, type MeridianInitialData } from "../src/pagination.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import type { ComponentKit } from "../src/component_kit.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
type Shape = "detailHeader" | "recordCard";
type Options = { subject?: string; seed?: MeridianInitialData; ambient?: Record<string, unknown>; selection?: Record<string, string>; admission?: AdmissionPolicy };
function panel(shape: Shape, enabled = true): PanelDescriptor {
  const populate = enabled ? { service: "fixture.Records", method: "Get" } : undefined;
  return fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, create(PanelDescriptorSchema, {
    panelId: "record", body: shape === "detailHeader"
      ? { case: "detailHeader", value: { titleSourcePath: "name", title: "Record", populate, descriptorRows: [{ label: "Name", sourcePath: "name" }] } }
      : { case: "recordCard", value: { populate, fields: [{ fieldId: "name", label: "Name", kind: { case: "text", value: {} } }] } },
  })));
}
async function session(kit: ComponentKit, run: (container: HTMLElement, render: (
  descriptor: PanelDescriptor, invoker: RpcInvoker, options?: Options
) => Promise<void>) => Promise<void>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const render = async (descriptor: PanelDescriptor, invoker: RpcInvoker, options: Options = {}) => {
    await act(async () => root.render(createElement(StrictMode, null, createElement(MeridianProvider, { kit, invoker, adhoc: {}, admission: options.admission,
      children: createElement(MeridianInitialDataContext.Provider, { value: options.seed,
        children: createElement(MeridianViewContext.Provider, { value: { subjectId: options.subject },
          children: createElement(MeridianSelectionContext.Provider, { value: { values: options.selection ?? {}, set: () => {} },
            children: createElement(MeridianRecordContext.Provider, { value: options.ambient,
              children: createElement(PanelRenderer, { descriptor }) }) }) }) }),
    }))));
  };
  try { await run(container, render); }
  finally { await act(async () => root.unmount()); container.remove(); }
}

for (const kit of [htmlKit, shadcnKit]) for (const shape of ["detailHeader", "recordCard"] as const)
describe(`${kit.id} ${shape} record lifecycle`, () => {
  it("does not refetch equal wire descriptors or expose a previous subject while loading", async () => {
    await session(kit, async (container, render) => {
      let finish!: (value: object) => void;
      const invoke = vi.fn((_s: string, _m: string, request: object) => (request as { id?: string }).id === "old"
        ? Promise.resolve({ name: "Old record" }) : new Promise<object>(resolve => { finish = resolve; }));
      const transport = { invoke };
      await render(panel(shape), transport, { subject: "old" });
      expect(container.textContent).toContain("Old record");
      await render(panel(shape), transport, { subject: "old" });
      expect(invoke).toHaveBeenCalledOnce();
      await render(panel(shape), transport, { subject: "new" });
      expect(container.textContent).not.toContain("Old record");
      expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading record");
      await act(async () => finish({ name: "Current record" }));
      expect(container.textContent).toContain("Current record");
    });
  });
  it("ignores late replies and an old transport when the current request fails", async () => {
    await session(kit, async (container, render) => {
      let finish!: (value: object) => void;
      await render(panel(shape), { invoke: () => new Promise<object>(resolve => { finish = resolve; }) });
      await render(panel(shape), { invoke: async () => { throw new Error("offline"); } });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Failed to load record");
      await act(async () => finish({ name: "Stale transport" }));
      expect(container.textContent).not.toContain("Stale transport");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
  });
  it("reports synchronous failures and retries through the same host invoker", async () => {
    await session(kit, async (container, render) => {
      let failed = true;
      const invoke = vi.fn(() => { if (failed) throw new Error("offline"); return Promise.resolve({ name: "Recovered record" }); });
      await render(panel(shape), { invoke });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Failed to load record");
      failed = false;
      await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Retry record")!.click());
      expect(container.textContent).toContain("Recovered record");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(invoke).toHaveBeenCalledTimes(2);
    });
  });
  it.each([{ response: null }, { response: [] }, { response: "invalid" }])("rejects non-record envelopes $response", async ({ response }) => {
    await session(kit, async (container, render) => {
      await render(panel(shape), { invoke: async () => response as unknown as object });
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Failed to load record");
    });
  });
  it("seeds StrictMode without refetch but never reuses that seed for another subject", async () => {
    await session(kit, async (container, render) => {
      const seed = { "fixture.Records.Get": { rows: [{ name: "Seeded record" }] } };
      let finish!: (value: object) => void;
      const invoke = vi.fn(() => new Promise<object>(resolve => { finish = resolve; }));
      const transport = { invoke };
      await render(panel(shape), transport, { subject: "seed", seed });
      expect(container.textContent).toContain("Seeded record");
      expect(invoke).not.toHaveBeenCalled();
      await render(panel(shape), transport, { subject: "other", seed });
      expect(container.textContent).not.toContain("Seeded record");
      expect(invoke).toHaveBeenCalledOnce();
      await act(async () => finish({ name: "Other record" }));
      expect(container.textContent).toContain("Other record");
    });
  });
  it("resolves nested live bindings without consuming an unscoped seed or losing false and zero", async () => {
    await session(kit, async (_container, render) => {
      const descriptor = panel(shape);
      if (descriptor.body.case !== shape) throw new Error("record required");
      descriptor.body.value.populate!.bindings.push(create(FieldBindingSchema, { requestField: "scope", source: { case: "nested", value: { fields: [
        { requestField: "selected", source: { case: "selectionKey", value: "picked" } },
        { requestField: "count", source: { case: "rowField", value: "count" } },
        { requestField: "enabled", source: { case: "rowField", value: "enabled" } },
      ] } } }));
      const invoke = vi.fn(async () => ({ name: "Scoped record" }));
      await render(descriptor, { invoke }, { subject: "subject", seed: { "fixture.Records.Get": { rows: [{ name: "Wrong seed" }] } }, selection: { picked: "chosen" }, ambient: { count: 0, enabled: false } });
      expect(invoke).toHaveBeenCalledWith("fixture.Records", "Get", { id: "subject", scope: { selected: "chosen", count: 0, enabled: false } });
    });
  });
  it("drops fetched values when populate is removed and follows the ambient record", async () => {
    await session(kit, async (container, render) => {
      const invoke = vi.fn(async () => ({ name: "Fetched record" }));
      const transport = { invoke };
      await render(panel(shape), transport);
      await render(panel(shape, false), transport, { ambient: { name: "Ambient record" } });
      expect(container.textContent).toContain("Ambient record");
      await render(panel(shape, false), transport);
      expect(container.textContent).not.toContain("Fetched record");
      expect(container.textContent).not.toContain("Ambient record");
    });
  });
  it("does not resurrect an older result when populate is disabled and re-enabled", async () => {
    await session(kit, async (container, render) => {
      let finish!: (value: object) => void;
      const invoke = vi.fn().mockResolvedValueOnce({ name: "Earlier record" })
        .mockImplementation(() => new Promise<object>(resolve => { finish = resolve; }));
      const transport = { invoke };
      await render(panel(shape), transport);
      await render(panel(shape, false), transport);
      await render(panel(shape), transport);
      expect(container.textContent).not.toContain("Earlier record");
      expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading record");
      await act(async () => finish({ name: "Refetched record" }));
      expect(container.textContent).toContain("Refetched record");
    });
  });
  it("refetches changed bound selections but not unrelated selection state", async () => {
    await session(kit, async (container, render) => {
      const descriptor = panel(shape);
      if (descriptor.body.case !== "detailHeader" && descriptor.body.case !== "recordCard") throw new Error("record required");
      descriptor.body.value.populate!.bindings.push(create(FieldBindingSchema, { requestField: "id", source: { case: "selectionKey", value: "picked" } }));
      const invoke = vi.fn(async (_s: string, _m: string, request: object) => ({ name: `Selected ${(request as { id: string }).id}` }));
      const transport = { invoke };
      await render(descriptor, transport, { subject: "subject", selection: { picked: "one" } });
      expect(container.textContent).toContain("Selected one");
      await render(descriptor, transport, { subject: "subject", selection: { picked: "two" } });
      expect(container.textContent).toContain("Selected two");
      expect(container.textContent).not.toContain("Selected one");
      await render(descriptor, transport, { subject: "subject", selection: { picked: "two", unrelated: "changed" } });
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenLastCalledWith("fixture.Records", "Get", { id: "two" });
    });
  });
  it("does not bypass read admission on the initial request or retry", async () => {
    await session(kit, async (container, render) => {
      const invoke = vi.fn(async () => ({ name: "Forbidden record" }));
      const onDenied = vi.fn();
      await render(panel(shape), { invoke }, { admission: { reads: [], onDenied } });
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Retry record")!.click());
      expect(invoke).not.toHaveBeenCalled();
      expect(onDenied).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toContain("Forbidden record");
    });
  });
});
