import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { act, createElement, StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { InvocationCapabilities, InvocationHost } from "@savvifi/meridian-schemas/uiview";
import type { ComponentKit } from "../src/component_kit.js";

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Same real-control contract runs against all three kits, not a mock button. */
export function affordanceContract(kit: ComponentKit, runtime: {
  MeridianProvider: typeof import("../src/provider.js").MeridianProvider;
  PanelRenderer: typeof import("../src/panel_renderer.js").PanelRenderer;
  reactWebRenderer: typeof import("../src/react_web_renderer.js").reactWebRenderer;
}) {
  // MUI consumes the packaged renderer under Bazel, while reference kits use
  // their own build output. Use that consumer's public runtime consistently;
  // importing another provider copy would create a different React context.
  const { MeridianProvider, PanelRenderer, reactWebRenderer } = runtime;
  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterAll(() => vi.unstubAllGlobals());

  function setup(data: JsonObject = { copy: "raw" }) {
    const capabilities = {
      uri: vi.fn<NonNullable<InvocationCapabilities["uri"]>>(async () => {}),
      command: vi.fn<NonNullable<InvocationCapabilities["command"]>>(async () => {}),
      navigate: vi.fn<NonNullable<InvocationCapabilities["navigate"]>>(async () => {}),
      openPanel: vi.fn<NonNullable<InvocationCapabilities["openPanel"]>>(async () => {}),
      openView: vi.fn<NonNullable<InvocationCapabilities["openView"]>>(async () => {}),
      copy: vi.fn<NonNullable<InvocationCapabilities["copy"]>>(async () => {}),
    };
    const invoke = vi.fn(async (..._args: unknown[]) => ({})), onAction = vi.fn();
    const admit = vi.fn(() => true), refresh = vi.fn(async () => {});
    const affordance = fromJson(AffordanceSchema, { label: "Perform action", description: "An explanation", ...data });
    const descriptor = create(PanelDescriptorSchema, { panelId: "real-action", body: { case: "action", value: { action: affordance } } });
    let invocation: InvocationHost = { capabilities, admit, refresh, context: {
      currentResourcePath: "resource/raw", uiIdentity: null, selectedRow: { id: "row-one", state: "OPEN" },
      formValues: {}, selections: { tenant: "raw-tenant" },
    } };
    let admission = { mutations: ["raw.Service/Get"] };
    const invoker = { invoke }, adhoc = {};
    const tree = () => createElement(StrictMode, {}, createElement(MeridianProvider, {
      kit, invoker, adhoc, invocation, admission, onAction, children: createElement(PanelRenderer, { descriptor }),
    }));
    const container = document.createElement("div");
    let root: ReturnType<typeof createRoot> | undefined;
    const button = (label = "Perform action") => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(node => node.textContent?.trim() === label)!;
    return {
      capabilities, invoke, onAction, admit, refresh, affordance, descriptor, container, button,
      get invocation() { return invocation; },
      set invocation(value: InvocationHost) { invocation = value; },
      set admission(value: { mutations: string[] }) { admission = value; },
      server() { return renderToStaticMarkup(tree()); },
      async mount() { document.body.append(container); root = createRoot(container); await act(async () => root!.render(tree())); },
      async hydrate() {
        document.body.append(container); container.innerHTML = renderToStaticMarkup(tree());
        const original = button(), errors: unknown[] = [];
        await act(async () => { root = hydrateRoot(container, tree(), { onRecoverableError: error => errors.push(error) }); });
        return { original, errors };
      },
      async update() { await act(async () => root!.render(tree())); },
      async click(label?: string) { await act(async () => button(label).click()); },
      async close() { if (root) await act(async () => root!.unmount()); container.remove(); },
    };
  }

  describe(`${kit.id} real Affordance activation`, () => {
    it.each([
      ["uri", { uri: "cursor://raw/e\u0301" }], ["command", { command: "raw '$arg'\n" }],
      ["navigate", { navigate: { route: "/raw/e\u0301" } }], ["openPanel", { openPanel: { panelId: "inline",
        table: { populate: { service: "raw.Service", method: "List" } } } }],
      ["openView", { openView: "raw-view" }], ["copy", { copy: "" }],
    ] as const)("%s requires a user gesture and executes exactly one typed capability", async (kind, target) => {
      const host = setup(target);
      try {
        expect(host.server()).not.toContain("href=");
        await host.mount();
        await act(async () => host.button().focus());
        expect(host.admit).not.toHaveBeenCalled();
        for (const effect of Object.values(host.capabilities)) expect(effect).not.toHaveBeenCalled();
        expect(host.container.querySelector("[data-copy]")).toBeNull();
        await host.click();
        expect(host.capabilities[kind]).toHaveBeenCalledTimes(1);
        expect(host.capabilities[kind]).toHaveBeenCalledWith(host.affordance.invoke.value, expect.any(Object), expect.any(AbortSignal));
        for (const [name, effect] of Object.entries(host.capabilities)) if (name !== kind) expect(effect).not.toHaveBeenCalled();
        expect(host.invoke).not.toHaveBeenCalled();
        expect(host.onAction).not.toHaveBeenCalled();
        const status = host.container.querySelector('[role="status"]')!;
        expect(status.textContent).toBe("Action completed.");
        expect(host.button().getAttribute("aria-describedby")).toBe(status.id);
        expect(document.activeElement).toBe(host.button());
      } finally { await host.close(); }
    });

    it("SSR hydration preserves the actual control and performs no admission or effects", async () => {
      const host = setup({ uri: "cursor://raw" });
      try {
        const hydrated = await host.hydrate();
        expect(hydrated.errors).toEqual([]);
        expect(host.button()).toBe(hydrated.original);
        expect(host.admit).not.toHaveBeenCalled();
        expect(host.capabilities.uri).not.toHaveBeenCalled();
        await host.click();
        expect(host.capabilities.uri).toHaveBeenCalledTimes(1);
      } finally { await host.close(); }
    });

    it("the framework-neutral mount passes explicit capabilities and current runtime context", async () => {
      const host = setup({ copy: "mounted raw" });
      const context = { currentResourcePath: "mount/current", uiIdentity: null, selectedRow: { id: "mount-row" }, formValues: {} };
      let handle: Awaited<ReturnType<ReturnType<typeof reactWebRenderer>["mount"]>> | undefined;
      try {
        document.body.append(host.container);
        await act(async () => { handle = await reactWebRenderer(kit).mount({ container: host.container, descriptor: host.descriptor,
          invoker: { invoke: host.invoke }, invocation: host.invocation, context }); });
        await host.click();
        expect(host.capabilities.copy).toHaveBeenCalledTimes(1);
        expect(host.capabilities.copy).toHaveBeenCalledWith("mounted raw", context, expect.any(AbortSignal));
      } finally {
        if (handle) await act(async () => handle!.unmount());
        await host.close();
      }
    });

    it.each(["catalog", "steps", "connectFlow"] as const)("nested %s affordances use the same actual activation path", async kind => {
      const host = setup({ copy: "nested raw" });
      const action = host.affordance;
      const nested = kind === "catalog" ? create(PanelDescriptorSchema, { body: { case: "catalog", value: { items: [{ id: "item", action }] } } })
        : kind === "steps" ? create(PanelDescriptorSchema, { body: { case: "steps", value: { steps: [{ label: "Step", action }] } } })
        : create(PanelDescriptorSchema, { body: { case: "connectFlow", value: { targets: [{ id: "target", label: "Client", actions: [action] }] } } });
      host.descriptor.body = nested.body;
      try {
        await host.mount();
        expect(host.capabilities.copy).not.toHaveBeenCalled();
        await host.click();
        expect(host.capabilities.copy).toHaveBeenCalledTimes(1);
        expect(host.capabilities.copy).toHaveBeenCalledWith("nested raw", expect.any(Object), expect.any(AbortSignal));
      } finally { await host.close(); }
    });

    it("missing canonical target remains visibly denied without reviving a legacy callback", async () => {
      const host = setup({});
      try {
        await host.mount(); await host.click();
        expect(host.container.querySelector('[role="status"]')!.textContent).toContain("missing or unsupported");
        expect(host.onAction).not.toHaveBeenCalled();
        expect(host.invoke).not.toHaveBeenCalled();
        expect(host.capabilities.copy).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it.each(["", "  "])("blank canonical labels %j retain an accessible control name without merging legacy text", async label => {
      const host = setup({ label, copy: "raw" });
      try {
        await host.mount();
        const button = host.button("");
        expect(button.getAttribute("aria-label")).toBe("Action");
        expect(button.textContent).toBe(label);
        await host.click("");
        expect(host.capabilities.copy).toHaveBeenCalledTimes(1);
      } finally { await host.close(); }
    });

    it("unsafe runtime context fails visibly before executing accessors or capabilities", async () => {
      const host = setup({ copy: "private" });
      const get = vi.fn(() => { throw new Error("private getter secret"); });
      host.invocation = { ...host.invocation, context: { ...host.invocation.context!,
        selectedRow: Object.defineProperty({}, "id", { enumerable: true, get }),
      } };
      try {
        await host.mount();
        expect(host.button().disabled).toBe(true);
        expect(host.container.querySelector('[role="status"]')!.textContent).toContain("invalid or exceeds supported limits");
        expect(get).not.toHaveBeenCalled();
        expect(host.capabilities.copy).not.toHaveBeenCalled();
        expect(host.container.textContent).not.toContain("secret");
      } finally { await host.close(); }
    });

    it("explicit canonical false suppresses refresh after a successful effect", async () => {
      const host = setup({ copy: "raw", refreshOnSuccess: false });
      try {
        await host.mount(); await host.click();
        expect(host.capabilities.copy).toHaveBeenCalledTimes(1);
        expect(host.refresh).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it("RPC Get builds current bindings through Rust and cannot use read-tier/default grants", async () => {
      const host = setup({ rpc: { service: "raw.Service", method: "Get", bindings: [
        { requestField: "id", rowField: "id" }, { requestField: "tenant", selectionKey: "tenant" },
      ] } });
      try {
        host.admission = { mutations: [] };
        await host.mount(); await host.click();
        expect(host.container.querySelector('[role="status"]')!.textContent).toContain("mutation policy");
        expect(host.invoke).not.toHaveBeenCalled();
        host.admission = { mutations: ["raw.Service/Get"] };
        host.invocation = { ...host.invocation, context: { ...host.invocation.context!, selectedRow: { id: "current-row" } } };
        await host.update(); await host.click();
        expect(host.invoke).toHaveBeenCalledTimes(1);
        expect(host.invoke).toHaveBeenCalledWith("raw.Service", "Get", { id: "current-row", tenant: "raw-tenant" }, expect.any(AbortSignal));
      } finally { await host.close(); }
    });

    it("missing policy or capability visibly denies with no legacy callback or clipboard fallback", async () => {
      const host = setup({ command: "private command" });
      try {
        host.invocation = { ...host.invocation, admit: undefined };
        await host.mount(); await host.click();
        expect(host.container.querySelector('[role="status"]')!.textContent).toContain("target policy");
        expect(host.capabilities.command).not.toHaveBeenCalled();
        host.invocation = { ...host.invocation, admit: host.admit, capabilities: { copy: host.capabilities.copy } };
        await host.update(); await host.click();
        expect(host.container.querySelector('[role="status"]')!.textContent).toContain("required capability");
        expect(host.capabilities.copy).not.toHaveBeenCalled();
        expect(host.onAction).not.toHaveBeenCalled();
      } finally { await host.close(); }
    });

    it("predicate and raw descriptor changes followed by a render invalidate even reused objects", async () => {
      const host = setup({ copy: "old", enabledWhen: { fieldPath: "state", equals: "OPEN" } });
      try {
        await host.mount();
        host.invocation.context!.selectedRow = { id: "row-two", state: "CLOSED" };
        await host.update(); await host.click();
        expect(host.container.querySelector('[role="status"]')!.textContent).toContain("conditions");
        expect(host.capabilities.copy).not.toHaveBeenCalled();
        host.invocation.context!.selectedRow = { id: "row-three", state: "OPEN" };
        host.affordance.invoke = { case: "copy", value: "raw e\u0301" };
        await host.update(); await host.click();
        expect(host.capabilities.copy).toHaveBeenCalledTimes(1);
        expect(host.capabilities.copy).toHaveBeenCalledWith("raw e\u0301", expect.objectContaining({ selectedRow: { id: "row-three", state: "OPEN" } }), expect.any(AbortSignal));
      } finally { await host.close(); }
    });

    it("pending duplicates do not execute; cancellation aborts and returns focus without refreshing", async () => {
      const host = setup({ copy: "raw", refreshOnSuccess: true });
      const effect = deferred();
      host.capabilities.copy.mockImplementation(() => effect.promise);
      try {
        await host.mount(); await act(async () => host.button().focus()); await host.click(); await host.click();
        expect(host.button().getAttribute("aria-busy")).toBe("true");
        expect(host.capabilities.copy).toHaveBeenCalledTimes(1);
        const signal = host.capabilities.copy.mock.calls[0][2];
        await act(async () => host.button("Cancel action").focus()); await host.click("Cancel action");
        expect(signal.aborted).toBe(true);
        await act(async () => effect.resolve());
        expect(host.container.querySelector('[role="status"]')!.textContent).toBe("Action canceled.");
        expect(host.refresh).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(host.button());
      } finally { effect.resolve(); await host.close(); }
    });

    it("capability replacement suppresses late failure and retry uses the newly committed scope", async () => {
      const host = setup({ copy: "old", refreshOnSuccess: true });
      const effect = deferred();
      host.capabilities.copy.mockImplementationOnce(() => effect.promise);
      try {
        await host.mount(); await host.click();
        const next = vi.fn<NonNullable<InvocationCapabilities["copy"]>>(async () => {});
        host.invocation = { ...host.invocation, capabilities: { copy: next } };
        host.affordance.invoke = { case: "copy", value: "new" };
        await host.update();
        await act(async () => effect.reject(new Error("private transport secret")));
        expect(host.container.textContent).not.toContain("secret");
        expect(host.refresh).not.toHaveBeenCalled();
        await host.click();
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith("new", expect.any(Object), expect.any(AbortSignal));
        expect(host.refresh).toHaveBeenCalledTimes(1);
      } finally { effect.resolve(); await host.close(); }
    });

    it("unmount aborts pending work and late completion cannot refresh", async () => {
      const host = setup({ copy: "raw", refreshOnSuccess: true });
      const effect = deferred();
      host.capabilities.copy.mockImplementation(() => effect.promise);
      await host.mount(); await host.click();
      const signal = host.capabilities.copy.mock.calls[0][2];
      await host.close();
      expect(signal.aborted).toBe(true);
      await act(async () => effect.resolve());
      expect(host.refresh).not.toHaveBeenCalled();
    });

    it("a failed capability remains sanitized and a failed refresh is not an action failure", async () => {
      const host = setup({ copy: "raw", refreshOnSuccess: true });
      try {
        host.capabilities.copy.mockRejectedValueOnce(new Error("private capability secret"));
        await host.mount(); await host.click();
        expect(host.container.querySelector('[role="status"]')!.textContent).toBe("Action failed. Try again with the current context.");
        expect(host.refresh).not.toHaveBeenCalled();
        host.refresh.mockRejectedValueOnce(new Error("private refresh secret"));
        await host.click();
        expect(host.container.querySelector('[role="status"]')!.textContent).toContain("without repeating the action");
        expect(host.container.textContent).not.toContain("secret");
      } finally { await host.close(); }
    });
  });
}
