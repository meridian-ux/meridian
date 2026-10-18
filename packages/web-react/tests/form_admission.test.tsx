// @vitest-environment jsdom
import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { InvocationHost } from "@savvifi/meridian-schemas/uiview";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

describe.each([htmlKit, shadcnKit])("$id actual form admission", kit => {
  function setup(intent: JsonObject = { copy: "literal" }) {
    const descriptor = create(PanelDescriptorSchema, { body: { case: "form", value: { mode: 2, itemNoun: "legacy record",
      submit: { service: "legacy.Forms", method: "Delete" }, submitAffordance: fromJson(AffordanceSchema, { label: "Canonical submit", ...intent }), fields: [
        { fieldId: "name", requestField: "legacy.name", label: "Name", kind: { case: "text", value: { defaultValue: "raw/e\u0301", minLength: 2 } } },
        { fieldId: "zero", label: "Zero", kind: { case: "integer", value: { defaultValue: 0 } } },
        { fieldId: "flag", label: "Flag", kind: { case: "boolean", value: { defaultValue: false } } },
      ] } } });
    if (descriptor.body.case !== "form") throw new Error("Expected form");
    const form = descriptor.body.value;
    const invoke = vi.fn(async () => ({}));
    const capability = () => vi.fn(async (_target: unknown, _context: unknown, _signal: AbortSignal) => {});
    const caps = { copy: capability(), uri: capability(), command: capability(), navigate: capability(), openPanel: capability(), openView: capability() };
    const admit = vi.fn(() => true), onAction = vi.fn();
    let invocation: InvocationHost = { capabilities: caps, admit, context: {
      currentResourcePath: "current/raw", uiIdentity: { id: "caller" }, selectedRow: { id: 0 }, formValues: { undeclared: "host secret" }, selections: { tenant: false },
    } };
    let admission = { mutations: ["raw.Forms/Get", "legacy.Forms/Delete"], reads: ["raw.Forms/Get"] };
    const invoker = { invoke }, adhoc = {};
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const mount = async () => { await act(async () => root.render(createElement(StrictMode, {}, createElement(MeridianProvider, {
      kit, invoker, adhoc, admission, invocation, onAction, children: createElement(PanelRenderer, { descriptor }),
    })))); };
    return { form, invoke, caps, admit, onAction, container, mount,
      set invocation(value: InvocationHost) { invocation = value; }, get invocation() { return invocation; },
      set admission(value: typeof admission) { admission = value; },
      submit: async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); },
      input: () => container.querySelector<HTMLInputElement>('input[name="legacy.name"]')!,
      close: async () => { await act(async () => root.unmount()); container.remove(); },
    };
  }

  it.each<JsonObject>([{ copy: "literal" }, { uri: "/safe" }, { command: "literal command" },
    { navigate: { route: "/safe" } }, { openPanel: { panelId: "inline" } }, { openView: "view" }])("executes explicit canonical %j with collected current values", async intent => {
    const host = setup(intent);
    try {
      await host.mount(); host.input().focus();
      expect(host.admit).not.toHaveBeenCalled();
      for (const cap of Object.values(host.caps)) expect(cap).not.toHaveBeenCalled();
      host.input().value = "changed/e\u0301";
      await host.submit();
      const kind = Object.keys(intent)[0] as keyof typeof host.caps;
      expect(host.caps[kind]).toHaveBeenCalledTimes(1);
      expect(host.caps[kind].mock.calls[0]![1]).toEqual({ ...host.invocation.context,
        formValues: { name: "changed/e\u0301", zero: 0, flag: false } });
      expect(host.invoke).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
    } finally { await host.close(); }
  });

  it("uses canonical RPC bindings and real Rust automatic mappings without the legacy call", async () => {
    const host = setup({ rpc: { service: "raw.Forms", method: "Get", bindings: [
      { requestField: "copied", formField: "name" }, { requestField: "scope", selectionKey: "tenant" },
      { requestField: "row", rowField: "id" }, { requestField: "name", literal: "bound" },
    ] } });
    try {
      await host.mount(); await host.submit();
      expect(host.invoke.mock.calls).toEqual([["raw.Forms", "Get", { name: "bound", copied: "raw/e\u0301", scope: false, row: 0, zero: 0, flag: false }]]);
      expect(host.input().value).toBe("raw/e\u0301");
    } finally { await host.close(); }
  });

  it.each(["empty", "denied", "missing", "mutation"])("canonical %s never revives a legacy submit", async mode => {
    const host = setup(mode === "empty" ? {} : mode === "mutation" ? { rpc: { service: "raw.Forms", method: "Get" } } : { copy: "secret" });
    host.invocation = { ...host.invocation, capabilities: mode === "missing" ? {} : host.caps, admit: () => mode !== "denied" };
    if (mode === "mutation") host.admission = { mutations: ["legacy.Forms/Delete"], reads: ["raw.Forms/Get"] };
    try {
      await host.mount(); await host.submit();
      expect(host.container.querySelector('[role="alert"]')?.textContent).toMatch(/Action (denied|unavailable)/);
      expect(host.invoke).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled();
      expect(host.onAction).not.toHaveBeenCalled();
    } finally { await host.close(); }
  });

  it("validates current fields before host policy, capability, or transport", async () => {
    const host = setup();
    try {
      await host.mount(); host.input().value = ""; await host.submit();
      expect(host.container.querySelector('[role="alert"]')?.textContent).toContain("invalid length");
      expect(host.admit).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
    } finally { await host.close(); }
  });

  it("retains canonical submit description, icon key, tone, and explicit emphasis without granting invocation", async () => {
    const host = setup({ label: "Canonical submit", description: "Explain the effect", icon: "save",
      tone: 5, emphasis: 2, copy: "literal" });
    try {
      await host.mount();
      const button = host.container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(button.dataset.icon).toBe("save"); expect(button.dataset.merTone).toBe("danger");
      expect(button.dataset.merEmphasis).toBe("secondary"); expect(button.style.borderWidth).toBe("1px");
      expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe("Explain the effect");
      expect(host.admit).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled();
    } finally { await host.close(); }
  });

  it("does not collect FormData during paint or focus", async () => {
    const Original = globalThis.FormData;
    let reads = 0;
    vi.stubGlobal("FormData", class extends Original {
      constructor(...args: ConstructorParameters<typeof FormData>) { super(...args); reads++; }
    });
    const host = setup();
    try {
      await host.mount(); host.input().focus(); expect(reads).toBe(0);
      await host.submit(); expect(reads).toBeGreaterThan(0);
    } finally { await host.close(); vi.stubGlobal("FormData", Original); }
  });

  it("rechecks values after a host policy callback instead of executing changed input under old consent", async () => {
    const host = setup();
    host.invocation = { ...host.invocation, admit: () => { host.input().value = "changed without an input event"; return true; } };
    try {
      await host.mount(); await host.submit();
      expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
      expect(host.container.textContent).not.toContain("Saved.");
    } finally { await host.close(); }
  });

  it("blocks duplicates until a noncooperative effect settles and suppresses late success after edits", async () => {
    const host = setup();
    let release!: () => void;
    host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    try {
      await host.mount(); await host.submit(); await host.submit();
      expect(host.caps.copy).toHaveBeenCalledTimes(1);
      const signal = host.caps.copy.mock.calls[0]![2];
      host.input().value = "new input";
      await act(async () => host.input().dispatchEvent(new Event("input", { bubbles: true })));
      expect(signal.aborted).toBe(true);
      await host.submit(); expect(host.caps.copy).toHaveBeenCalledTimes(1);
      await act(async () => release()); expect(host.container.textContent).not.toContain("Saved.");
      await host.submit(); expect(host.caps.copy).toHaveBeenCalledTimes(2);
    } finally { release?.(); await host.close(); }
  });

  it("sanitizes failure, retains input for retry, and does not replay on refresh failure", async () => {
    const host = setup({ copy: "literal", refreshOnSuccess: true });
    host.caps.copy.mockRejectedValueOnce(new Error("raw private transport details"));
    const refresh = vi.fn(async () => { throw new Error("private refresh details"); });
    host.invocation = { ...host.invocation, refresh };
    try {
      await host.mount(); host.input().value = "preserved"; await host.submit();
      expect(host.container.querySelector('[role="alert"]')?.textContent).toContain("Action failed");
      expect(host.container.textContent).not.toContain("raw private transport details"); expect(host.input().value).toBe("preserved");
      await host.submit(); expect(host.caps.copy).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledTimes(1);
      expect(host.container.textContent).toContain("refresh is unavailable");
      expect(host.container.textContent).not.toContain("private refresh details");
    } finally { await host.close(); }
  });

  it("aborts on unmount and suppresses late success and refresh", async () => {
    const host = setup({ copy: "literal", refreshOnSuccess: true });
    let release!: () => void;
    const refresh = vi.fn(async () => {});
    host.invocation = { ...host.invocation, refresh };
    host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    try {
      await host.mount(); await host.submit();
      const signal = host.caps.copy.mock.calls[0]![2];
      await host.close(); expect(signal.aborted).toBe(true);
      await act(async () => release());
      expect(refresh).not.toHaveBeenCalled(); expect(host.container.textContent).toBe("");
    } finally { release?.(); await host.close(); }
  });

  it("keeps cancel reachable and returns focus to the submitted control after settlement", async () => {
    const host = setup();
    let release!: () => void;
    host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    try {
      await host.mount();
      const trigger = host.container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      await act(async () => { trigger.focus(); trigger.click(); });
      const cancel = [...host.container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Cancel action")!;
      await act(async () => { cancel.focus(); cancel.click(); });
      expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true);
      await act(async () => release());
      expect(document.activeElement).toBe(trigger); expect(trigger.disabled).toBe(false);
    } finally { release?.(); await host.close(); }
  });

  it("does not carry a previous Saved status into a replacement record context", async () => {
    const host = setup();
    try {
      await host.mount(); await host.submit(); expect(host.container.textContent).toContain("Saved.");
      host.invocation = { ...host.invocation, context: { ...host.invocation.context!, selectedRow: { id: 1 } } };
      await host.mount(); expect(host.container.textContent).not.toContain("Saved.");
      expect(host.caps.copy).toHaveBeenCalledTimes(1);
    } finally { await host.close(); }
  });

  it.each(["uri", "navigate"])("disables unsafe canonical %s even with a permissive host grant", async kind => {
    const host = setup(kind === "uri" ? { uri: "javascript:alert(1)" } : { navigate: { route: "data:text/html,unsafe" } });
    try {
      await host.mount(); expect(host.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
      await host.submit(); expect(host.container.querySelector('[role="alert"]')?.textContent).toContain("unsafe");
      expect(host.admit).not.toHaveBeenCalled(); for (const cap of Object.values(host.caps)) expect(cap).not.toHaveBeenCalled();
    } finally { await host.close(); }
  });
});
