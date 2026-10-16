// @vitest-environment jsdom
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema, type PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FieldBindingSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import type { ComponentKit } from "../src/component_kit.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianRecordContext } from "../src/pagination.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
const panel = (method = "Get", enabled = true) => fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema,
  create(PanelDescriptorSchema, { panelId: "metric", title: "Metric", body: { case: "stat", value: {
    label: "Requests", value: 7, format: 5, previous: 3, higherIsBetter: true,
    valueField: "metric.current", previousField: "metric.prior", seriesField: "metric.history", displayField: "shown",
    populate: enabled ? { service: "fixture.Metrics", method, bindings: [{ requestField: "tenant", source: { case: "literal", value: method } }] } : undefined,
  } } })));

async function session(kit: ComponentKit, run: (root: Root, container: HTMLElement,
  render: (descriptor: PanelDescriptor, invoker: RpcInvoker, record?: Record<string, unknown>) => Promise<void>) => Promise<void>) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const render = async (descriptor: PanelDescriptor, invoker: RpcInvoker, record?: Record<string, unknown>) => {
    await act(async () => root.render(createElement(MeridianProvider, { kit, invoker, adhoc: {},
      children: createElement(MeridianRecordContext.Provider, { value: record,
        children: createElement(PanelRenderer, { descriptor }) }),
    })));
  };
  try { await run(root, container, render); }
  finally { await act(async () => root.unmount()); container.remove(); }
}

for (const kit of [htmlKit, shadcnKit]) describe(`${kit.id} fetched Stat lifecycle`, () => {
  it.each(["large", "cycle", "unsafe"])("rejects %s bindings without invocation or stale values, then recovers", async mode => {
    await session(kit, async (_root, container, render) => {
      const descriptor = panel();
      if (descriptor.body.case !== "stat") throw new Error("stat required");
      descriptor.body.value.populate!.bindings.push(create(FieldBindingSchema, {
        requestField: mode === "unsafe" ? "constructor.prototype.scope" : "payload", source: { case: "rowField", value: "payload" },
      }));
      const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
      const invoke = vi.fn(async () => ({ shown: "Current metric" }));
      const transport = { invoke };
      await render(panel(), transport);
      expect(container.textContent).toContain("Current metric");
      await render(descriptor, transport, { payload: mode === "cycle" ? cyclic : "\0".repeat(800_000) });
      expect(invoke).toHaveBeenCalledOnce();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Failed to load metric.");
      expect(container.textContent).not.toContain("Current metric");
      await render(panel(), transport);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain("Current metric");
    });
  });

  it("builds nested populate bindings from a repeated-view record without losing false or zero", async () => {
    await session(kit, async (_root, _container, render) => {
      const descriptor = panel();
      if (descriptor.body.case !== "stat") throw new Error("stat descriptor");
      descriptor.body.value.populate!.bindings.push(create(FieldBindingSchema, { requestField: "details", source: { case: "nested", value: { fields: [
          { requestField: "count", source: { case: "rowField", value: "count" } },
          { requestField: "enabled", source: { case: "rowField", value: "enabled" } },
        ] } } }));
      const invoke = vi.fn(async () => ({ metric: { current: 0 } }));
      await render(descriptor, { invoke }, { count: 0, enabled: false });
      expect(invoke).toHaveBeenCalledWith("fixture.Metrics", "Get", { tenant: "Get", details: { count: 0, enabled: false } });
    });
  });
  it("builds bindings and keeps computed direction independent of a server display override", async () => {
    await session(kit, async (_root, container, render) => {
      const invoke = vi.fn(async () => ({ metric: { current: 0, prior: 2, history: [1, 0] }, shown: "Server amount", trend: "up" }));
      const descriptor = panel();
      await render(descriptor, { invoke });
      expect(invoke).toHaveBeenCalledWith("fixture.Metrics", "Get", { tenant: "Get" });
      expect(container.textContent).toContain("Server amount");
      expect(container.textContent).toContain("↓ -2");
      expect(container.querySelector('[data-trend="down"][data-semantics="bad"]')).not.toBeNull();
      expect(descriptor.body.case === "stat" && descriptor.body.value.value).toBe(7);
    });
  });

  it("ignores late responses, avoids refetching equal descriptors, and clears data for static descriptors", async () => {
    await session(kit, async (_root, container, render) => {
      const pending = new Map<string, (response: object) => void>();
      const invoke = vi.fn((_service: string, method: string) => new Promise<object>(resolve => pending.set(method, resolve)));
      const transport = { invoke };
      await render(panel("Old"), transport);
      await render(panel("New"), transport);
      expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading metric");
      await act(async () => pending.get("New")!({ shown: "Current metric", metric: { current: 12 } }));
      await act(async () => pending.get("Old")!({ shown: "Obsolete metric", metric: { current: 999 } }));
      expect(container.textContent).toContain("Current metric");
      expect(container.textContent).not.toContain("Obsolete metric");
      await render(panel("New"), transport);
      expect(invoke).toHaveBeenCalledTimes(2);
      await render(panel("New", false), transport);
      expect(container.textContent).not.toContain("Current metric");
      expect(container.textContent).toContain("7");
      expect(invoke).toHaveBeenCalledTimes(2);
    });
  });

  it("does not expose a previous transport's result while a replacement is loading", async () => {
    await session(kit, async (_root, container, render) => {
      await render(panel(), { invoke: async () => ({ shown: "Old transport" }) });
      let finish!: (response: object) => void;
      const invoke = vi.fn(() => new Promise<object>(resolve => { finish = resolve; }));
      await render(panel(), { invoke });
      expect(container.textContent).not.toContain("Old transport");
      expect(container.querySelector('[role="status"]')).not.toBeNull();
      await act(async () => finish({ shown: "New transport" }));
      expect(container.textContent).toContain("New transport");
      expect(invoke).toHaveBeenCalledOnce();
    });
  });

  it.each(["reject", "null", "array"])("reports %s responses visibly and retains authored values", async mode => {
    await session(kit, async (_root, container, render) => {
      await render(panel(), { invoke: async () => {
        if (mode === "reject") throw new Error("unavailable");
        return (mode === "null" ? null : []) as unknown as object;
      } });
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Failed to load metric.");
      expect(container.textContent).toContain("7");
      expect(container.querySelector('[role="status"]')).toBeNull();
    });
  });
});
