// @vitest-environment jsdom
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ActionPlacement, ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { ViewRenderer } from "../src/view_renderer.js";
import { MeridianRecordContext } from "../src/pagination.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mounted(node: ReactNode, check: (container: HTMLElement) => Promise<void>) {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(node));
    await check(container);
  } finally {
    await act(async () => root.unmount());
  }
}

describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s action interaction contract", (_name, kit) => {
  it("preserves the canonical ActionPanel's named navigation control without dialing an RPC", async () => {
    const source = FIXTURES.find(fixture => fixture.shape === "action")!.descriptor;
    const descriptor = fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, source));
    const invoke = vi.fn(async () => ({}));
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke } },
      createElement(PanelRenderer, { descriptor })), async container => {
      const link = container.querySelector("a")!;
      expect(link.textContent).toBe("Add to Cursor");
      expect(link.getAttribute("href")).toBe("cursor://anysphere.cursor-deeplink/mcp/install");
      // Cancel browser navigation while checking the actual activation path.
      link.addEventListener("click", event => event.preventDefault());
      await act(async () => link.click());
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  it("invokes an admitted unbound view action exactly once with an empty request", async () => {
    const invoke = vi.fn(async () => ({}));
    const view = create(ViewDescriptorSchema, { id: "actions", actions: [{
      id: "run", label: "Run report", placement: ActionPlacement.HEADER,
      call: { service: "demo.Reports", method: "Run" },
    }] });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      admission: { mutations: ["demo.Reports/Run"] } }, createElement(ViewRenderer, { view })), async container => {
      const button = container.querySelector("button")!;
      expect(button.type).toBe("button");
      expect(button.textContent).toBe("Run report");
      expect(invoke).not.toHaveBeenCalled();
      await act(async () => button.click());
      expect(invoke.mock.calls).toEqual([["demo.Reports", "Run", {}]]);
    });
  });

  it("resolves nested bindings from the current selection and ambient record on each activation", async () => {
    const invoke = vi.fn(async () => ({}));
    const selection = { values: { scope: "year-1" }, set: () => {} };
    const record = { owner: { id: "member-7" }, enabled: false, count: 0 };
    const view = create(ViewDescriptorSchema, { id: "bound", actions: [{
      id: "run", label: "Run bound report", call: { service: "demo.Reports", method: "Run", bindings: [
        { requestField: "mode", source: { case: "literal", value: "audit" } },
        { requestField: "filter", source: { case: "nested", value: { fields: [
          { requestField: "year", source: { case: "selectionKey", value: "scope" } },
          { requestField: "owner.id", source: { case: "rowField", value: "owner.id" } },
          { requestField: "enabled", source: { case: "rowField", value: "enabled" } },
          { requestField: "count", source: { case: "rowField", value: "count" } },
          { requestField: "missing", source: { case: "selectionKey", value: "unset" } },
        ] } } },
      ] },
    }] });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke }, admission: "unrestricted" },
      createElement(MeridianRecordContext.Provider, { value: record }, createElement(ViewRenderer, { view, selection }))), async container => {
      await act(async () => container.querySelector("button")!.click());
      expect(invoke).toHaveBeenLastCalledWith("demo.Reports", "Run", {
        mode: "audit", filter: { year: "year-1", owner: { id: "member-7" }, enabled: false, count: 0 },
      });
      selection.values.scope = "year-2";
      await act(async () => container.querySelector("button")!.click());
      expect(invoke).toHaveBeenLastCalledWith("demo.Reports", "Run", {
        mode: "audit", filter: { year: "year-2", owner: { id: "member-7" }, enabled: false, count: 0 },
      });
      expect(record).toEqual({ owner: { id: "member-7" }, enabled: false, count: 0 });
    });
  });

  it("preserves the ActionPanel command copy contract without invoking an RPC", async () => {
    const invoke = vi.fn(async () => ({}));
    const descriptor = create(PanelDescriptorSchema, { body: { case: "action", value: {
      action: { label: "Copy command", invoke: { case: "command", value: "meridian inspect" } },
    } } });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke } },
      createElement(PanelRenderer, { descriptor })), async container => {
      const button = container.querySelector("button")!;
      expect(button.textContent).toBe("Copy command");
      expect(button.dataset.copy).toBe("meridian inspect");
      await act(async () => button.click());
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  it("omits unavailable sources and unsafe paths without inventing action context", async () => {
    const invoke = vi.fn(async () => ({}));
    const view = create(ViewDescriptorSchema, { id: "missing", actions: [{ id: "run", label: "Run", call: {
      service: "demo.Reports", method: "Run", bindings: [
        { requestField: "record", source: { case: "rowField", value: "id" } },
        { requestField: "form", source: { case: "formField", value: "name" } },
        { requestField: "scope", source: { case: "nested", value: { fields: [
          { requestField: "id", source: { case: "selectionKey", value: "unset" } },
        ] } } },
        { requestField: "__proto__.meridianTest", source: { case: "literal", value: "unsafe" } },
      ],
    } }] });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke }, admission: "unrestricted" },
      createElement(ViewRenderer, { view })), async container => {
      await act(async () => container.querySelector("button")!.click());
      expect(invoke).toHaveBeenCalledWith("demo.Reports", "Run", {});
      expect(Object.hasOwn(Object.prototype, "meridianTest")).toBe(false);
    });
  });

  it("blocks a denied mutation before transport and reports the exact denied call to the host", async () => {
    const invoke = vi.fn(async () => ({}));
    const onDenied = vi.fn();
    const view = create(ViewDescriptorSchema, { id: "actions", actions: [{
      id: "delete", label: "Delete report", placement: ActionPlacement.HEADER,
      call: { service: "demo.Reports", method: "Delete", bindings: [
        { requestField: "id", source: { case: "literal", value: "protected-report" } },
      ] },
    }] });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      admission: { mutations: [], onDenied } }, createElement(ViewRenderer, { view })), async container => {
      const button = container.querySelector("button")!;
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(container.textContent).toContain("This action is unavailable.");
      expect(onDenied).not.toHaveBeenCalled();
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("This action is unavailable.");
      expect(invoke).not.toHaveBeenCalled();
      expect(onDenied).toHaveBeenCalledTimes(1);
      expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({
        tier: "mutation", service: "demo.Reports", method: "Delete",
      }));
    });
  });

  it("announces failure and allows retry while suppressing duplicate pending activation", async () => {
    let reject!: (reason: Error) => void;
    const invoke = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValue({});
    const view = create(ViewDescriptorSchema, { id: "retry", actions: [{
      id: "run", label: "Run report", placement: ActionPlacement.HEADER,
      call: { service: "demo.Reports", method: "Run" },
    }] });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      admission: "unrestricted" }, createElement(ViewRenderer, { view })), async container => {
      const button = container.querySelector("button")!;
      await act(async () => { button.click(); button.click(); });
      expect(button.disabled).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(1);
      await act(async () => reject(new Error("private backend details")));
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Action failed. Try again.");
      expect(container.textContent).not.toContain("private backend details");
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      expect(invoke.mock.calls).toEqual([["demo.Reports", "Run", {}], ["demo.Reports", "Run", {}]]);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });
  });
});
