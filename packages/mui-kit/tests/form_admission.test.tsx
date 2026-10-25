import { create, fromJson, toJson, type JsonObject } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { readFrozen } from "../../../schemas/tests/frozen_affordance.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InvocationHost, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { PanelRenderer } from "@savvifi/meridian-web-react";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

function setup(intent: JsonObject = { copy: "literal" }) {
  const descriptor = create(PanelDescriptorSchema, { body: { case: "form", value: { mode: 2, itemNoun: "legacy",
    submitAffordance: fromJson(AffordanceSchema, { label: "Canonical submit", ...intent }), fields: [
      { fieldId: "name", label: "Name", requestField: "legacy.name", kind: { case: "text", value: { defaultValue: "initial", minLength: 2 } } },
      { fieldId: "zero", label: "Zero", kind: { case: "integer", value: { defaultValue: 0 } } },
      { fieldId: "flag", label: "Flag", kind: { case: "boolean", value: { defaultValue: false } } },
    ] } } });
  if (descriptor.body.case !== "form") throw new Error("Expected form");
  const form = descriptor.body.value;
  Object.assign(form, readFrozen(FormPanelSchema, { ...toJson(FormPanelSchema, form), submit: { service: "legacy.Forms", method: "Delete" } }));
  const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({}));
  const cap = () => vi.fn(async (_target: unknown, _context: unknown, _signal: AbortSignal) => {});
  const caps = { uri: cap(), command: cap(), navigate: cap(), openPanel: cap(), openView: cap(), copy: cap() };
  const admit = vi.fn(() => true), onAction = vi.fn();
  let invocation: InvocationHost = { capabilities: caps, admit, context: {
    currentResourcePath: "current/raw", uiIdentity: { id: "caller" }, selectedRow: { id: 0 }, formValues: { undeclared: "not collected" }, selections: { tenant: false },
  } };
  let admission = { mutations: ["raw.Forms/Get", "legacy.Forms/Delete"], reads: ["raw.Forms/Get", "read.Forms/GetInitial"] };
  const invoker = { invoke };
  const tree = () => <MeridianMuiProvider invoker={invoker} invocation={invocation} admission={admission} onAction={onAction}>
    <PanelRenderer descriptor={descriptor} />
  </MeridianMuiProvider>;
  let mounted: ReturnType<typeof render>;
  return { form, descriptor, invoke, caps, admit, onAction,
    get invocation() { return invocation; }, set invocation(value: InvocationHost) { invocation = value; },
    set admission(value: typeof admission) { admission = value; },
    mount: () => { mounted = render(tree()); }, update: () => mounted.rerender(tree()), unmount: () => mounted.unmount(),
    input: () => screen.getByLabelText("Name") as HTMLInputElement,
    change: (value: string) => fireEvent.change(screen.getByLabelText("Name"), { target: { value } }),
    submit: () => fireEvent.click(screen.getByRole("button", { name: "Canonical submit" })),
  };
}

describe("actual MUI form admission", () => {
  it.each<JsonObject>([{ uri: "/safe" }, { command: "literal command" }, { navigate: { route: "/safe" } },
    { openPanel: { panelId: "inline" } }, { openView: "view" }, { copy: "literal" }])("executes canonical %j with exact committed collected values", async intent => {
    const host = setup(intent); host.mount(); host.input().focus();
    expect(host.admit).not.toHaveBeenCalled();
    for (const effect of Object.values(host.caps)) expect(effect).not.toHaveBeenCalled();
    host.change("raw/e\u0301"); host.submit();
    const kind = Object.keys(intent)[0] as keyof typeof host.caps;
    await waitFor(() => expect(host.caps[kind]).toHaveBeenCalledTimes(1));
    expect(host.caps[kind].mock.calls[0]![1]).toEqual({ ...host.invocation.context, formValues: { name: "raw/e\u0301", zero: 0, flag: false } });
    expect(host.invoke).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
    expect(host.input().value).toBe("raw/e\u0301");
  });

  it("uses the canonical RPC and actual Rust automatic mapping with explicit-binding precedence", async () => {
    const host = setup({ rpc: { service: "raw.Forms", method: "Get", bindings: [
      { requestField: "copied", formField: "name" }, { requestField: "name", literal: "bound" },
      { requestField: "row", rowField: "id" }, { requestField: "scope", selectionKey: "tenant" },
    ] } });
    host.mount(); host.change("raw/e\u0301"); host.submit();
    await waitFor(() => expect(host.invoke).toHaveBeenCalledWith("raw.Forms", "Get", { copied: "raw/e\u0301", name: "bound", row: 0, scope: false, zero: 0, flag: false }));
    expect(host.invoke).toHaveBeenCalledTimes(1); expect(host.input().value).toBe("raw/e\u0301");
  });

  it.each(["empty", "missing", "denied", "mutation"])("canonical %s never revives the legacy submit", async mode => {
    const host = setup(mode === "empty" ? {} : mode === "mutation" ? { rpc: { service: "raw.Forms", method: "Get" } } : { copy: "literal" });
    host.invocation = { ...host.invocation, capabilities: mode === "missing" ? {} : host.caps, admit: () => mode !== "denied" };
    if (mode === "mutation") host.admission = { reads: ["raw.Forms/Get"], mutations: ["legacy.Forms/Delete"] };
    host.mount(); host.submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Action (denied|unavailable)/);
    expect(host.invoke).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
  });

  it("explains missing mutation permission without running a host callback during paint", () => {
    const host = setup({ rpc: { service: "raw.Forms", method: "Get" } });
    host.admission = { reads: ["raw.Forms/Get"], mutations: [] }; host.mount();
    expect(screen.getByRole("status").textContent).toBe("Saving is not permitted.");
    const button = screen.getByRole("button", { name: "Canonical submit" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe("Saving is not permitted.");
    expect(host.admit).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
  });

  it("validates before host policy, capability, or transport", () => {
    const host = setup(); host.mount(); host.change(""); host.submit();
    expect(screen.getByRole("alert").textContent).toContain("invalid length");
    expect(host.admit).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
  });

  it("keeps failed create input and resets only after actual successful settlement", async () => {
    const host = setup(); host.form.fields = [create(FormFieldSchema, { fieldId: "name", label: "Name", kind: { case: "text", value: { minLength: 2 } } })];
    host.caps.copy.mockRejectedValueOnce(new Error("private transport details"));
    host.mount(); host.change("created"); host.submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Action failed");
    expect(document.body.textContent).not.toContain("private transport details"); expect(host.input().value).toBe("created");
    host.submit(); await waitFor(() => expect(host.input().value).toBe("")); expect(host.caps.copy).toHaveBeenCalledTimes(2);
  });

  it("does not reset or invite mutation replay after a failed refresh", async () => {
    const host = setup({ copy: "literal", refreshOnSuccess: true });
    host.form.fields = [create(FormFieldSchema, { fieldId: "name", label: "Name", kind: { case: "text", value: {} } })];
    const refresh = vi.fn(async () => { throw new Error("private refresh"); }); host.invocation = { ...host.invocation, refresh };
    host.mount(); host.change("created"); host.submit();
    await screen.findByText(/refresh is unavailable/);
    expect(host.input().value).toBe("created"); expect(host.caps.copy).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("private refresh");
  });

  it("blocks duplicates through cancellation and restores focus only after noncooperative settlement", async () => {
    const host = setup(); let release!: () => void;
    host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    host.mount(); const trigger = screen.getByRole("button", { name: "Canonical submit" }) as HTMLButtonElement;
    trigger.focus(); host.submit(); host.submit();
    expect(host.caps.copy).toHaveBeenCalledTimes(1); expect(host.input().disabled).toBe(true);
    const cancel = screen.getByRole("button", { name: "Cancel action" }); cancel.focus(); fireEvent.click(cancel);
    expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true); host.submit(); expect(host.caps.copy).toHaveBeenCalledTimes(1);
    await act(async () => release()); expect(document.activeElement).toBe(trigger); expect(host.input().disabled).toBe(false);
  });

  it("suppresses late reset and refresh against replacement context", async () => {
    const host = setup({ copy: "literal", refreshOnSuccess: true }); let release!: () => void;
    const refresh = vi.fn(async () => {}); host.invocation = { ...host.invocation, refresh };
    host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    host.mount(); host.change("preserved"); host.submit();
    host.invocation = { ...host.invocation, context: { ...host.invocation.context!, selectedRow: { id: 1 } } }; host.update();
    expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true);
    await act(async () => release()); expect(refresh).not.toHaveBeenCalled(); expect(host.input().value).toBe("preserved");
    expect(document.body.textContent).not.toContain("Action completed.");
  });

  it("waits for declared prefill before mounting editable controls and never resets the loaded record", async () => {
    const host = setup(); let release!: (value: object) => void;
    host.form.fields = [create(FormFieldSchema, { fieldId: "name", label: "Name", kind: { case: "text", value: {} } })];
    host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
    host.invoke.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    host.mount(); expect(screen.queryByLabelText("Name")).toBeNull(); expect(screen.queryByRole("button", { name: "Canonical submit" })).toBeNull();
    await waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(1));
    await act(async () => release({ name: "from server" })); expect(host.input().value).toBe("from server");
    host.submit(); await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1)); expect(host.input().value).toBe("from server");
  });

  it("prefill failure remains nonfatal, private, and leaves descriptor defaults", async () => {
    const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
    host.invoke.mockRejectedValueOnce(new Error("private prefill details")); host.mount();
    expect((await screen.findByLabelText("Name") as HTMLInputElement).value).toBe("initial");
    expect(screen.getByRole("alert").textContent).toContain("showing descriptor defaults");
    expect(document.body.textContent).not.toContain("private prefill details"); host.submit();
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  });

  it("ignores late prefill from a replaced form scope", async () => {
    const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
    const releases: Array<(value: object) => void> = [];
    host.invoke.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
    host.mount(); await waitFor(() => expect(releases).toHaveLength(1));
    host.form.itemNoun = "replacement"; host.update(); await waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => releases[0]!({ name: "obsolete" })); expect(screen.queryByLabelText("Name")).toBeNull();
    await act(async () => releases[1]!({ name: "current" })); expect(host.input().value).toBe("current");
    expect(host.caps.copy).not.toHaveBeenCalled();
  });

  it("aborts on unmount and does not refresh after late completion", async () => {
    const host = setup({ copy: "literal", refreshOnSuccess: true }); let release!: () => void;
    const refresh = vi.fn(async () => {}); host.invocation = { ...host.invocation, refresh };
    host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    host.mount(); host.submit(); const signal = host.caps.copy.mock.calls[0]![2];
    host.unmount(); expect(signal.aborted).toBe(true); await act(async () => release()); expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Canonical submit" })).toBeNull();
  });

  it("read-only forms neither prefill nor submit through forced form events", async () => {
    const host = setup(); host.form.mode = 1; host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
    host.mount(); await act(async () => {});
    expect(host.input().disabled).toBe(true); fireEvent.submit(document.querySelector("form")!);
    expect(host.invoke).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.admit).not.toHaveBeenCalled();
  });

  it("explains a false record predicate and executes only after the committed record qualifies", async () => {
    const host = setup({ copy: "literal", enabledWhen: { fieldPath: "state", equals: "OPEN" } });
    host.mount(); expect((screen.getByRole("button", { name: "Canonical submit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("conditions"); host.submit(); expect(host.caps.copy).not.toHaveBeenCalled();
    host.invocation = { ...host.invocation, context: { ...host.invocation.context!, selectedRow: { state: "OPEN" } } }; host.update(); host.submit();
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  });

  it("collects only declared own prefill fields, never inherited-looking metadata", async () => {
    const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
    host.invoke.mockResolvedValueOnce(JSON.parse('{"name":"from server","constructor":{"secret":"undeclared"},"__proto__":{"polluted":true}}'));
    host.mount(); await screen.findByLabelText("Name"); host.submit();
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
    expect(host.caps.copy.mock.calls[0]![1]).toEqual({ ...host.invocation.context, formValues: { name: "from server", zero: 0, flag: false } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("projects repeated prefill objects through their declared child fields", async () => {
    const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
    host.form.fields.push(create(FormFieldSchema, { fieldId: "entries", label: "Entries", kind: { case: "repeated", value: {
      element: { case: "object", value: { fields: [{ fieldId: "known", label: "Known", kind: { case: "text", value: {} } }] } },
    } } }));
    host.invoke.mockResolvedValueOnce({ name: "from server", entries: [{ known: "visible", secret: "not collected" }] });
    host.mount(); await screen.findByLabelText("Name"); host.submit();
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
    expect(host.caps.copy.mock.calls[0]![1]).toEqual({ ...host.invocation.context,
      formValues: { name: "from server", zero: 0, flag: false, entries: [{ known: "visible" }] } });
  });

  it("bounds repeated prefill before mounting controls and keeps descriptor defaults on rejection", async () => {
    const host = setup(); host.form.prefill = create(RpcCallSchema, { service: "read.Forms", method: "GetInitial" });
    host.form.fields.push(create(FormFieldSchema, { fieldId: "entries", label: "Entries", kind: { case: "repeated", value: {
      element: { case: "object", value: { fields: [{ fieldId: "known", label: "Known", kind: { case: "text", value: {} } }] } },
    } } }));
    host.invoke.mockResolvedValueOnce({ name: "too many", entries: Array.from({ length: 1001 }, () => ({ known: "never mount" })) });
    host.mount(); await screen.findByLabelText("Name");
    expect(host.input().value).toBe("initial"); expect(screen.queryByLabelText("Known")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("showing descriptor defaults");
    expect(host.caps.copy).not.toHaveBeenCalled();
  });

  it("rejects excess combined runtime binding work, retains input, and allows a smaller retry", async () => {
    const host = setup({ rpc: { service: "raw.Forms", method: "Get", bindings: Array.from({ length: 10 }, () => ({ requestField: "scope", rowField: "payload" })) } });
    host.invocation = { ...host.invocation, context: { ...host.invocation.context!, selectedRow: { payload: "s".repeat(400_000) } } };
    host.mount(); host.change("v".repeat(200_000)); host.submit();
    await screen.findByRole("alert"); expect(host.invoke).not.toHaveBeenCalled(); expect(host.input().value).toHaveLength(200_000);
    host.change("smaller"); host.submit(); await waitFor(() => expect(host.invoke).toHaveBeenCalledTimes(1));
    expect(host.invoke.mock.calls[0]![2]).toMatchObject({ name: "smaller", zero: 0, flag: false });
  });

  it("retains canonical submit presentation without implying a grant", () => {
    const host = setup({ description: "Explain the effect", icon: "save", tone: 5, emphasis: 2, copy: "literal" }); host.mount();
    const control = screen.getByRole("button", { name: "Canonical submit" }) as HTMLButtonElement;
    expect(control.dataset.icon).toBe("save"); expect(control.dataset.merTone).toBe("danger"); expect(control.dataset.merEmphasis).toBe("secondary");
    expect(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent).toBe("Explain the effect");
    expect(host.admit).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled();
  });
});
