// @vitest-environment jsdom
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ActionPlacement, ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { ViewRenderer } from "../src/view_renderer.js";
import { MeridianRecordContext } from "../src/pagination.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mounted(node: ReactNode, check: (container: HTMLElement) => Promise<void>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(node));
    await check(container);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s action interaction contract", (_name, kit) => {
  it("realizes primary, header, and overflow placements while keeping row actions out of the header", async () => {
    const invoke = vi.fn(async () => ({}));
    const onAction = vi.fn();
    const navigate = vi.fn(async () => {});
    const view = create(ViewDescriptorSchema, { id: "placed-actions", subjectKind: "report", affordances: { items: [
      { id: "run", label: "Run now", placement: ActionPlacement.HEADER, emphasis: 1,
        invoke: { case: "rpc", value: { service: "demo.Reports", method: "Run" } } },
      { id: "edit", label: "Edit report", placement: ActionPlacement.HEADER,
        invoke: { case: "navigate", value: { route: "/reports/edit" } } },
      { id: "export", label: "Export CSV", placement: ActionPlacement.OVERFLOW,
        invoke: { case: "rpc", value: { service: "demo.Reports", method: "Export", bindings: [
          { requestField: "format", source: { case: "literal", value: "csv" } },
        ] } } },
      { id: "row-delete", label: "Delete row", placement: ActionPlacement.ROW },
    ] } });
    await mounted(createElement(MeridianProvider, {
      kit, adhoc: {}, invoker: { invoke }, onAction, admission: "unrestricted",
      invocation: { capabilities: { navigate }, admit: intent => intent.case === "navigate" || intent.case === "rpc" },
    }, createElement(ViewRenderer, { view })), async container => {
      expect(kit.ActionBar).toBeDefined();
      expect(container.querySelector("[data-action-bar]")?.getAttribute("data-action-bar")).toBe(kit.id);
      const labels = [...container.querySelectorAll("button")].filter(button => !button.closest("[hidden]"))
        .map((button) => button.textContent?.trim());
      expect(labels).toEqual(["Run now", "Edit report", "⋮"]);
      expect(container.textContent).not.toContain("Delete row");

      const button = (label: string) => [...container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === label)!;
      await act(async () => button("Run now").click());
      await act(async () => button("Edit report").click());
      expect(invoke).toHaveBeenCalledWith("demo.Reports", "Run", {});
      expect(onAction).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ route: "/reports/edit" }), expect.any(Object), expect.any(AbortSignal));

      const overflow = container.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
      await act(async () => overflow.click());
      expect(overflow.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector('[role="menu"]')).not.toBeNull();
      const exportAction = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
      expect(exportAction.textContent).toBe("Export CSV");
      await act(async () => exportAction.click());
      expect(invoke).toHaveBeenLastCalledWith("demo.Reports", "Export", { format: "csv" });
      expect(container.querySelector('[role="menu"]:not([hidden])')).toBeNull();
    });
  });

  it("activates the canonical ActionPanel only through the host URI capability without dialing an RPC", async () => {
    const source = FIXTURES.find(fixture => fixture.shape === "action")!.descriptor;
    const descriptor = fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, source));
    const invoke = vi.fn(async () => ({}));
    const uri = vi.fn(async () => {});
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      invocation: { capabilities: { uri }, admit: intent => intent.case === "uri" } },
      createElement(PanelRenderer, { descriptor })), async container => {
      const button = container.querySelector("button")!;
      expect(button.textContent).toBe("Add to Cursor");
      expect(container.querySelector("a")).toBeNull();
      expect(uri).not.toHaveBeenCalled();
      await act(async () => button.click());
      expect(uri).toHaveBeenCalledTimes(1);
      expect(uri).toHaveBeenCalledWith("cursor://anysphere.cursor-deeplink/mcp/install", expect.any(Object), expect.any(AbortSignal));
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  it("invokes an admitted unbound view action exactly once with an empty request", async () => {
    const invoke = vi.fn(async () => ({}));
    const view = create(ViewDescriptorSchema, { id: "actions", affordances: { items: [{
      id: "run", label: "Run report", placement: ActionPlacement.HEADER,
      invoke: { case: "rpc", value: { service: "demo.Reports", method: "Run" } },
    }] } });
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
    const view = create(ViewDescriptorSchema, { id: "bound", affordances: { items: [{
      id: "run", label: "Run bound report", invoke: { case: "rpc", value: { service: "demo.Reports", method: "Run", bindings: [
        { requestField: "mode", source: { case: "literal", value: "audit" } },
        { requestField: "filter", source: { case: "nested", value: { fields: [
          { requestField: "year", source: { case: "selectionKey", value: "scope" } },
          { requestField: "owner.id", source: { case: "rowField", value: "owner.id" } },
          { requestField: "enabled", source: { case: "rowField", value: "enabled" } },
          { requestField: "count", source: { case: "rowField", value: "count" } },
          { requestField: "missing", source: { case: "selectionKey", value: "unset" } },
        ] } } },
      ] } },
    }] } });
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

  it("denies ActionPanel commands without an explicit host capability and never copies them", async () => {
    const invoke = vi.fn(async () => ({}));
    const descriptor = create(PanelDescriptorSchema, { body: { case: "action", value: {
      action: { label: "Copy command", invoke: { case: "command", value: "meridian inspect" } },
    } } });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke } },
      createElement(PanelRenderer, { descriptor })), async container => {
      const button = container.querySelector("button")!;
      expect(button.textContent).toBe("Copy command");
      expect(button.dataset.copy).toBeUndefined();
      await act(async () => button.click());
      expect(invoke).not.toHaveBeenCalled();
      expect(container.querySelector('[role="status"]')!.textContent).toContain("required capability");
    });
  });

  it.each([false, true])("omits unavailable sources but rejects an unsafe request as a whole (unsafe=%s)", async unsafe => {
    const invoke = vi.fn(async () => ({}));
    const view = create(ViewDescriptorSchema, { id: "missing", affordances: { items: [{ id: "run", label: "Run", invoke: { case: "rpc", value: {
      service: "demo.Reports", method: "Run", bindings: [
        { requestField: "record", source: { case: "rowField", value: "id" } },
        { requestField: "form", source: { case: "formField", value: "name" } },
        { requestField: "scope", source: { case: "nested", value: { fields: [
          { requestField: "id", source: { case: "selectionKey", value: "unset" } },
        ] } } },
        ...(unsafe ? [{ requestField: "__proto__.meridianTest", source: { case: "literal" as const, value: "unsafe" } }] : []),
      ],
    } } }] } });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke }, admission: "unrestricted" },
      createElement(ViewRenderer, { view })), async container => {
      await act(async () => container.querySelector("button")!.click());
      if (unsafe) {
        expect(invoke).not.toHaveBeenCalled();
        expect(container.querySelector('[role="alert"]')?.textContent).toBe("Action failed. Try again with the current context.");
      } else expect(invoke).toHaveBeenCalledWith("demo.Reports", "Run", {});
      expect(Object.hasOwn(Object.prototype, "meridianTest")).toBe(false);
    });
  });

  it("blocks a denied mutation before transport and reports the exact denied call to the host", async () => {
    const invoke = vi.fn(async () => ({}));
    const onDenied = vi.fn();
    const view = create(ViewDescriptorSchema, { id: "actions", affordances: { items: [{
      id: "delete", label: "Delete report", placement: ActionPlacement.HEADER,
      invoke: { case: "rpc", value: { service: "demo.Reports", method: "Delete", bindings: [
        { requestField: "id", source: { case: "literal", value: "protected-report" } },
      ] } },
    }] } });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      admission: { mutations: [], onDenied } }, createElement(ViewRenderer, { view })), async container => {
      const button = container.querySelector("button")!;
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(container.textContent).toContain("This action is unavailable.");
      expect(onDenied).not.toHaveBeenCalled();
      expect(normalizeDom(container)).toMatchSnapshot("denied before activation");
      await act(async () => container.querySelector("button")!.click());
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Action denied: the host mutation policy does not allow this RPC.");
      expect(normalizeDom(container)).toMatchSnapshot("denied after activation");
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
    const view = create(ViewDescriptorSchema, { id: "retry", affordances: { items: [{
      id: "run", label: "Run report", placement: ActionPlacement.HEADER,
      invoke: { case: "rpc", value: { service: "demo.Reports", method: "Run" } },
    }] } });
    await mounted(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      admission: "unrestricted" }, createElement(ViewRenderer, { view })), async container => {
      const button = container.querySelector("button")!;
      await act(async () => { button.click(); button.click(); });
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(normalizeDom(container)).toMatchSnapshot("action pending");
      await act(async () => reject(new Error("private backend details")));
      expect(container.querySelector('[role="alert"]')?.textContent).toBe("Action failed. Try again with the current context.");
      expect(container.textContent).not.toContain("private backend details");
      expect(button.disabled).toBe(false);
      expect(normalizeDom(container)).toMatchSnapshot("action failed");
      await act(async () => button.click());
      expect(invoke.mock.calls).toEqual([["demo.Reports", "Run", {}], ["demo.Reports", "Run", {}]]);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(normalizeDom(container)).toMatchSnapshot("action retry succeeded");
    });
  });
});
