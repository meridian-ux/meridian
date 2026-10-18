// @vitest-environment jsdom
import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { CommandSchema, LaunchpadSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import type { AdmissionPolicy, InvocationHost } from "@savvifi/meridian-schemas/uiview";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Launchpad } from "../src/index.js";

afterEach(cleanup);
function setup(intent: JsonObject = { copy: "canonical" }) {
  const command = create(CommandSchema, { id: "raw-command", title: "Envelope title", keywords: ["discoverable"], deepLink: "javascript:must-not-fall-back",
    action: { case: "navigate", value: { route: "/legacy" } }, affordance: fromJson(AffordanceSchema, { label: "Canonical command", ...intent }) });
  const descriptor = create(LaunchpadSchema, { groups: [{ id: "commands", commands: [command] }] });
  const cap = () => vi.fn(async (_target: unknown, _context: unknown, _signal: AbortSignal) => {});
  const caps = { uri: cap(), command: cap(), navigate: cap(), openPanel: cap(), openView: cap(), copy: cap() };
  const invoke = vi.fn(async (_service: string, _method: string, _request: unknown) => ({}));
  const invoker = { invoke };
  const onClose = vi.fn(), onRun = vi.fn(), onNavigate = vi.fn(), onOpenView = vi.fn(), onAction = vi.fn();
  const admit = vi.fn(() => true);
  let invocation: InvocationHost = { capabilities: caps, admit, context: {
    currentResourcePath: "raw/current", uiIdentity: { id: "caller" }, selectedRow: { id: 0 }, formValues: { raw: "e\u0301", zero: 0, active: false }, selections: { tenant: false },
  } };
  let admission: AdmissionPolicy = { mutations: ["raw.Service/Get"] }, open = true;
  const tree = () => <MeridianProvider invoker={invoker} kit={htmlKit} adhoc={{}} invocation={invocation} admission={admission} onAction={onAction}>
    <Launchpad descriptor={descriptor} open={open} onClose={onClose} onRun={onRun} onNavigate={onNavigate} onOpenView={onOpenView} />
  </MeridianProvider>;
  let mounted: ReturnType<typeof render>;
  return { command, descriptor, caps, invoke, admit, onClose, onRun, onNavigate, onOpenView, onAction,
    get invocation() { return invocation; }, set invocation(value: InvocationHost) { invocation = value; },
    set admission(value: AdmissionPolicy) { admission = value; }, set open(value: boolean) { open = value; },
    mount: () => { mounted = render(tree()); }, update: () => mounted.rerender(tree()), unmount: () => mounted.unmount(),
    option: () => screen.getByRole("option", { name: "Canonical command" }),
    run: () => fireEvent.click(screen.getByRole("option", { name: "Canonical command" })),
  };
}

it.each<JsonObject>([{ uri: "/safe" }, { command: "literal" }, { navigate: { route: "/safe" } },
  { openPanel: { panelId: "inline" } }, { openView: "raw-view" }, { copy: "raw-copy" }])("admits canonical %j with current context, not callbacks or unsafe legacy intent", async intent => {
  const host = setup(intent); host.mount();
  expect(host.admit).not.toHaveBeenCalled(); fireEvent.focus(host.option());
  for (const effect of Object.values(host.caps)) expect(effect).not.toHaveBeenCalled();
  host.run(); const key = Object.keys(intent)[0] as keyof typeof host.caps;
  await waitFor(() => expect(host.onRun).toHaveBeenCalledWith(host.command));
  expect(host.caps[key]).toHaveBeenCalledWith(expect.anything(), host.invocation.context, expect.any(AbortSignal));
  expect(host.onClose).toHaveBeenCalledTimes(1); expect(host.onNavigate).not.toHaveBeenCalled();
  expect(host.onOpenView).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
});

it("builds canonical RPC bindings with actual Rust and no command row-ID default", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get", bindings: [
    { requestField: "raw", formField: "raw" }, { requestField: "zero", rowField: "id" }, { requestField: "scope", selectionKey: "tenant" },
  ] } }); host.mount(); host.run();
  await waitFor(() => expect(host.onRun).toHaveBeenCalledWith(host.command));
  expect(host.invoke).toHaveBeenCalledTimes(1);
  expect(host.invoke).toHaveBeenCalledWith("raw.Service", "Get", { raw: "e\u0301", zero: 0, scope: false });
});

it.each(["empty", "capability", "policy", "mutation", "unsafe"])("keeps canonical %s denied without closing or notifying", async reason => {
  const host = setup(reason === "empty" ? {} : reason === "mutation" ? { rpc: { service: "raw.Service", method: "Get" } }
    : reason === "unsafe" ? { uri: "javascript:alert(1)" } : undefined);
  if (reason === "capability") host.invocation = { ...host.invocation, capabilities: {} };
  if (reason === "policy") host.admit.mockReturnValue(false);
  if (reason === "mutation") host.admission = { reads: ["raw.Service/Get"] };
  host.mount(); host.run();
  expect((await screen.findByRole("alert")).textContent).toMatch(/Action (denied|unavailable)/);
  expect(host.onClose).not.toHaveBeenCalled(); expect(host.onRun).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
  for (const effect of Object.values(host.caps)) expect(effect).not.toHaveBeenCalled();
});

it("waits for actual settlement, preserves failed command for retry, and sanitizes errors", async () => {
  const host = setup(); host.caps.copy.mockRejectedValueOnce(new Error("private host details")); host.mount(); host.run();
  expect((await screen.findByRole("alert")).textContent).toBe("Action failed. Try again with the current context.");
  expect(host.onClose).not.toHaveBeenCalled(); expect(host.onRun).not.toHaveBeenCalled();
  let settle!: () => void; host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  host.run(); await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(2));
  expect(host.onRun).not.toHaveBeenCalled(); expect(host.onClose).not.toHaveBeenCalled();
  await act(async () => settle()); await waitFor(() => expect(host.onRun).toHaveBeenCalledWith(host.command));
  expect(screen.queryByText(/private host/)).toBeNull();
});

it.each(["context", "query", "close", "unmount"])("aborts %s replacement and suppresses late completion", async replace => {
  const host = setup(); let settle!: () => void;
  host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; })); host.mount(); host.run();
  await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  if (replace === "context") { host.invocation = { ...host.invocation, context: { ...host.invocation.context!, currentResourcePath: "replacement" } }; host.update(); }
  if (replace === "query") fireEvent.change(screen.getByRole("combobox"), { target: { value: "discoverable" } });
  if (replace === "close") { host.open = false; host.update(); }
  if (replace === "unmount") host.unmount();
  expect(host.caps.copy.mock.calls[0]![2].aborted).toBe(true);
  await act(async () => settle()); expect(host.onClose).not.toHaveBeenCalled(); expect(host.onRun).not.toHaveBeenCalled();
});

it("keeps the duplicate guard across query replacement and close/reopen until canceled work settles", async () => {
  const host = setup(); let settle!: () => void;
  host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; })); host.mount(); host.run();
  await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "discoverable" } }); host.run();
  host.open = false; host.update(); host.open = true; host.update(); host.run();
  expect(host.caps.copy).toHaveBeenCalledTimes(1); expect(host.option().hasAttribute("disabled")).toBe(true);
  await act(async () => settle()); await waitFor(() => expect(host.option().hasAttribute("disabled")).toBe(false));
  host.run(); await waitFor(() => expect(host.onRun).toHaveBeenCalledWith(host.command));
});

it("preserves canonical presentation and the search envelope", () => {
  const host = setup({ copy: "literal", description: "Canonical explanation", icon: "canonical-icon", tone: "TONE_DANGER", emphasis: "EMPHASIS_PRIMARY" });
  host.mount(); fireEvent.change(screen.getByRole("combobox"), { target: { value: "discoverable" } });
  expect(screen.getByText("Envelope title")).toBeDefined();
  expect(host.option().getAttribute("data-mer-tone")).toBe("danger"); expect(host.option().getAttribute("data-mer-emphasis")).toBe("primary");
  expect(host.option().querySelector('[data-icon="canonical-icon"]')).not.toBeNull();
  expect(document.getElementById(host.option().getAttribute("aria-describedby")!)?.textContent).toBe("Canonical explanation");
});

it("keeps refresh failure visible without close, notification, or replay", async () => {
  const host = setup({ copy: "literal", refreshOnSuccess: true }); const refresh = vi.fn(async () => { throw new Error("private refresh"); });
  host.invocation = { ...host.invocation, refresh }; host.mount(); host.run();
  await screen.findByText(/without repeating the action/);
  expect(host.onClose).not.toHaveBeenCalled(); expect(host.onRun).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledTimes(1);
  expect(host.caps.copy).toHaveBeenCalledTimes(1);
});

it("does not treat deprecated callbacks as capability grants", async () => {
  const host = setup({ navigate: { route: "/safe" } }); host.invocation = { ...host.invocation, capabilities: {} }; host.mount(); host.run();
  await screen.findByRole("alert"); expect(host.onNavigate).not.toHaveBeenCalled(); expect(host.onOpenView).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
});

it("bounds aggregate mounted commands before rendering controls", () => {
  const host = setup(); host.descriptor.groups[0]!.commands = Array.from({ length: 1001 }, () => host.command); host.mount();
  expect(screen.getByRole("alert").textContent).toContain("exceeds supported limits");
  expect(screen.queryByRole("option")).toBeNull(); expect(host.admit).not.toHaveBeenCalled();
});

it("gives duplicated suggestions distinct keyboard identities without changing the search envelope", async () => {
  const host = setup(); host.descriptor.defaultCommandIds = [host.command.id]; host.mount();
  const options = screen.getAllByRole("option", { name: "Canonical command" });
  expect(options).toHaveLength(2); expect(options[0]!.id).not.toBe(options[1]!.id);
  const search = screen.getByRole("combobox");
  expect(search.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(search.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
  fireEvent.keyDown(search, { key: "Enter" }); await waitFor(() => expect(host.onRun).toHaveBeenCalledWith(host.command));
  expect(host.caps.copy).toHaveBeenCalledTimes(1);
});

it("keeps explicitly empty canonical labels and intents authoritative", async () => {
  const host = setup({ label: "" }); host.command.affordance = create(AffordanceSchema); host.mount();
  fireEvent.click(screen.getByRole("option", { name: "Command" }));
  await screen.findByRole("alert"); expect(host.onClose).not.toHaveBeenCalled(); expect(host.onNavigate).not.toHaveBeenCalled();
  expect(host.caps.copy).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
});

it("rejects oversized context before policy or transport", () => {
  const host = setup(); host.invocation = { ...host.invocation, context: { ...host.invocation.context!, formValues: { oversized: "x".repeat(800_000) } } }; host.mount();
  expect(screen.getByRole("alert").textContent).toContain("invalid or exceeds supported limits");
  host.run(); expect(host.admit).not.toHaveBeenCalled(); expect(host.onClose).not.toHaveBeenCalled(); expect(host.caps.copy).not.toHaveBeenCalled();
});
