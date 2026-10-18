import { create, type JsonObject, fromJson } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { CommandSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { AppShellSchema } from "@savvifi/meridian-proto-ts/proto/shell_pb.js";
import { act } from "react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { InvocationHost } from "@savvifi/meridian-schemas/uiview";
import { MeridianMuiProvider } from "../src/provider.js";
import { AppShellView } from "../src/shell/index.js";

afterEach(cleanup);
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
const Link = ({ href, children }: { href: string; children?: ReactNode }) => <a href={href}>{children}</a>;

function setup(intent: JsonObject = { copy: "raw" }) {
  const command = create(CommandSchema, { id: "command", title: "Search title", subtitle: "Envelope detail",
    keywords: ["synonym"], shortcut: "g p", affordance: fromJson(AffordanceSchema, intent),
    action: { case: "navigate", value: { route: "/legacy-must-not-run" } }, deepLink: "/legacy-link" });
  const shell = create(AppShellSchema, { title: "Palette", launchpad: { groups: [{ id: "commands", title: "Commands", commands: [command] }] } });
  const invoke = vi.fn(async () => ({})), navigate = vi.fn(), hrefFor = vi.fn(), onAction = vi.fn();
  const capability = () => vi.fn(async (_target: unknown, _context: unknown, _signal: AbortSignal) => {});
  const caps = { uri: capability(), command: capability(), navigate: capability(), openPanel: capability(), openView: capability(), copy: capability() };
  const context = { currentResourcePath: "current/raw", uiIdentity: null, selectedRow: { id: 0 }, formValues: {}, selections: { tenant: false } };
  let host: InvocationHost = { context, admit: vi.fn(() => true), capabilities: caps };
  let admission = { mutations: ["raw.Service/Get"], reads: ["raw.Service/Get"] };
  const invoker = { invoke };
  const routing = { Link, usePathname: () => "/", navigate };
  const tree = () => <MeridianMuiProvider invoker={invoker} invocation={host} admission={admission} onAction={onAction}>
    <AppShellView shell={shell} seams={{ routing, hrefFor }} />
  </MeridianMuiProvider>;
  const mounted = render(tree());
  const open = () => fireEvent.click(screen.getByLabelText("Open the launchpad"));
  const control = () => within(screen.getByRole("dialog")).getByRole("button", { name: /Search title/ });
  open();
  expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search commands" }));
  return { command, shell, caps, context, invoke, navigate, hrefFor, onAction, open, control,
    get host() { return host; }, set host(value: InvocationHost) { host = value; },
    set admission(value: typeof admission) { admission = value; },
    update: () => mounted.rerender(tree()), unmount: mounted.unmount };
}

describe("actual palette admission", () => {
  it.each<JsonObject>([
    { uri: "/canonical" }, { command: "literal command" }, { navigate: { route: "/canonical" } },
    { openPanel: { panelId: "canonical" } }, { openView: "canonical" }, { copy: "raw secret" },
  ])("runs one explicit typed capability without legacy routing: %j", async intent => {
    const host = setup(intent);
    expect(host.host.admit).not.toHaveBeenCalled();
    for (const capability of Object.values(host.caps)) expect(capability).not.toHaveBeenCalled();
    fireEvent.click(host.control());
    const kind = Object.keys(intent)[0] as keyof typeof host.caps;
    await waitFor(() => expect(host.caps[kind]).toHaveBeenCalledTimes(1));
    expect(host.caps[kind]).toHaveBeenCalledWith(expect.anything(), host.context, expect.any(AbortSignal));
    expect(host.navigate).not.toHaveBeenCalled(); expect(host.hrefFor).not.toHaveBeenCalled();
    expect(host.onAction).not.toHaveBeenCalled(); expect(host.invoke).not.toHaveBeenCalled();
  });

  it("binds RPCs through the real Rust builder and mutation gate, including Get", async () => {
    const host = setup({ rpc: { service: "raw.Service", method: "Get", bindings: [
      { requestField: "id", rowField: "id" }, { requestField: "tenant", selectionKey: "tenant" },
    ] } });
    fireEvent.click(host.control());
    await waitFor(() => expect(host.invoke).toHaveBeenCalledWith("raw.Service", "Get", { id: 0, tenant: false }));
    expect(host.navigate).not.toHaveBeenCalled();
  });

  it("read permission cannot authorize a palette mutation", async () => {
    const host = setup({ rpc: { service: "raw.Service", method: "Get" } });
    host.admission = { mutations: [], reads: ["raw.Service/Get"] }; host.update();
    fireEvent.click(host.control());
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("mutation policy"));
    expect(host.invoke).not.toHaveBeenCalled();
  });

  it.each(["empty", "denied", "missing"])("canonical %s never revives legacy intent or deep link", async mode => {
    const host = setup(mode === "empty" ? {} : { copy: "secret" });
    host.host = { ...host.host, admit: () => mode !== "denied", capabilities: mode === "missing" ? {} : host.caps };
    host.update(); fireEvent.click(host.control());
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Action (denied|unavailable)/));
    expect(host.invoke).not.toHaveBeenCalled(); expect(host.navigate).not.toHaveBeenCalled();
    expect(host.hrefFor).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
    expect(host.caps.copy).not.toHaveBeenCalled();
  });

  it("search and keyboard activation retain envelope metadata, not the canonical label", async () => {
    const host = setup({ label: "Not searchable", copy: "chosen" });
    const search = screen.getByRole("textbox", { name: "Search commands" });
    fireEvent.change(search, { target: { value: "synonym" } });
    expect(host.control().textContent).toContain("Envelope detail");
    expect(host.control().textContent).toContain("g p");
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
  });

  it("filters without executing and retains a noncooperative guard across close/reopen", async () => {
    const host = setup();
    let release!: () => void;
    host.caps.copy.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    fireEvent.click(host.control());
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
    const search = screen.getByRole("textbox", { name: "Search commands" });
    fireEvent.change(search, { target: { value: "no-such-command" } });
    expect(screen.queryByRole("button", { name: /Search title/ })).toBeNull();
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(host.control());
    expect(host.caps.copy).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    host.open(); fireEvent.click(host.control());
    expect(host.caps.copy).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(host.control());
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(2));
    await act(async () => release());
  });

  it("renders sanitized failure and permits a fresh retry", async () => {
    const host = setup();
    host.caps.copy.mockRejectedValueOnce(new Error("raw secret payload"));
    fireEvent.click(host.control());
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Action failed"));
    expect(document.body.textContent).not.toContain("raw secret payload");
    fireEvent.click(host.control());
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(2));
  });

  it("serializes distinct commands and preserves ranked Arrow/Enter activation", async () => {
    const host = setup();
    host.shell.launchpad!.groups[0]!.commands.push(create(CommandSchema, { id: "second", title: "Second",
      affordance: { invoke: { case: "copy", value: "second" } } }));
    host.update();
    let release!: () => void;
    host.caps.copy.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    fireEvent.click(host.control());
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(1));
    const second = screen.getByRole("button", { name: "Second" });
    expect(second.hasAttribute("disabled")).toBe(true); fireEvent.click(second);
    expect(host.caps.copy).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), { target: { value: "Second" } });
    expect(screen.getByText(/A command is still running/)).toBeTruthy();
    await act(async () => release());
    fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), { target: { value: "" } });
    const search = screen.getByRole("textbox", { name: "Search commands" });
    fireEvent.keyDown(search, { key: "ArrowDown" }); fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(host.caps.copy).toHaveBeenCalledTimes(2));
    expect(host.caps.copy.mock.calls[1]![0]).toBe("second");
  });

  it.each(["uri", "navigate"])("rejects an unsafe canonical %s even with a permissive host grant", async kind => {
    const host = setup(kind === "uri" ? { uri: "javascript:alert(1)" } : { navigate: { route: "javascript:alert(1)" } });
    expect(host.control().hasAttribute("disabled")).toBe(true);
    fireEvent.click(host.control());
    expect(screen.getByRole("status").textContent).toContain("unsafe");
    expect(host.host.admit).not.toHaveBeenCalled();
    for (const capability of Object.values(host.caps)) expect(capability).not.toHaveBeenCalled();
  });

  it("rejects excessive retained controls before mounting them", () => {
    const host = setup();
    host.shell.launchpad!.defaultCommandIds = Array(1001).fill("command"); host.update();
    expect(screen.getByRole("alert").textContent).toContain("exceeds supported limits");
    expect(screen.queryByRole("button", { name: /Search title/ })).toBeNull();
    expect(host.caps.copy).not.toHaveBeenCalled();
  });
});
