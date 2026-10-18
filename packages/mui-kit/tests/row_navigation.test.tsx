import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { InvocationHost, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { MeridianViewContext, PanelRenderer } from "@savvifi/meridian-web-react";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeridianMuiProvider } from "../src/provider.js";
import { AdmittedNavigationRow } from "../src/row_navigation.js";
import { MeridianTable } from "../src/components/table.js";

afterEach(cleanup);

it.each([false, true])("presenter runtime row slot is authoritative=%s without breaking direct host callbacks", canonical => {
  const onRowClick = vi.fn();
  render(<MeridianTable columns={[{ id: "name", header: "Name", render: () => "Presenter row" }]} rows={[{ id: 1 }]}
    onRowClick={onRowClick} rowHeader="Navigation"
    renderRow={canonical ? (_row, cells, key) => <tr key={key}><td>Owned navigation</td>{cells}</tr> : undefined} />);
  fireEvent.click(screen.getByText("Presenter row"));
  expect(onRowClick).toHaveBeenCalledTimes(canonical ? 0 : 1);
  expect(screen.queryByRole("columnheader", { name: "Navigation" }) !== null).toBe(canonical);
});
function setup(intent: JsonObject = { navigate: { route: "/records/raw" } }) {
  const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: {
    populate: { service: "demo.Rows", method: "List" }, rowsField: "items", columns: [{ header: "Name", fieldPath: "label" }],
  } } });
  const rows = [{ id: 0, label: "Zero", active: false }, { id: "raw/e\u0301", label: "Second", active: true }];
  const invoke = vi.fn<RpcInvoker["invoke"]>(async (_service, method) => method === "List" ? { items: rows } : {});
  const navigate = vi.fn(async (_value: unknown, _context: unknown, _signal: AbortSignal) => {});
  const onAction = vi.fn(), admit = vi.fn(() => true);
  const resolveSemantic = vi.fn<NonNullable<InvocationHost["resolveSemantic"]>>(() => ({ affordance: fromJson(AffordanceSchema, intent) }));
  let invocation: InvocationHost = { capabilities: { navigate }, resolveSemantic, admit, context: {
    currentResourcePath: "raw/current", uiIdentity: null, selectedRow: { id: "wrong" }, formValues: { untouched: false }, selections: { tenant: 0 },
  } };
  let subjectKind: string | undefined = "Records";
  const invoker = { invoke };
  const tree = () => <MeridianMuiProvider invoker={invoker} invocation={invocation} onAction={onAction} admission={{ reads: ["demo.Rows/List"] }}>
    <MeridianViewContext.Provider value={{ subjectKind }}><PanelRenderer descriptor={descriptor} /></MeridianViewContext.Provider>
  </MeridianMuiProvider>;
  let mounted: ReturnType<typeof render>;
  return { rows, invoke, navigate, onAction, admit, resolveSemantic,
    get invocation() { return invocation; }, set invocation(value: InvocationHost) { invocation = value; },
    set subjectKind(value: string | undefined) { subjectKind = value; },
    mount: () => { mounted = render(tree()); }, update: () => mounted.rerender(tree()), unmount: () => mounted.unmount(),
    open: () => screen.getByRole("button", { name: "Open Records 0" }),
    ready: () => screen.findByRole("button", { name: "Open Records 0" }),
  };
}

it.each(["button", "row"])("admits %s navigation with the exact current row and zero subject", async gesture => {
  const host = setup(); host.mount(); await host.ready();
  expect(host.resolveSemantic).not.toHaveBeenCalled(); expect(host.admit).not.toHaveBeenCalled();
  fireEvent.focus(host.open()); expect(host.resolveSemantic).not.toHaveBeenCalled();
  fireEvent.click(gesture === "row" ? screen.getByText("Zero") : host.open());
  await waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(1));
  expect(host.resolveSemantic).toHaveBeenCalledWith(expect.objectContaining({ id: "open" }),
    { ...host.invocation.context, selectedRow: host.rows[0] }, { entityType: "Records", entityId: 0 });
  expect(host.navigate).toHaveBeenCalledWith(expect.objectContaining({ route: "/records/raw" }),
    { ...host.invocation.context, selectedRow: host.rows[0] }, expect.any(AbortSignal));
  expect(host.onAction).not.toHaveBeenCalled(); expect(host.invoke).toHaveBeenCalledTimes(1);
});

it.each(["resolver", "unresolved", "capability", "policy", "unsafe", "empty", "rpc"])("denies %s without legacy fallback", async reason => {
  const host = setup(reason === "unsafe" ? { navigate: { route: "javascript:alert(1)" } }
    : reason === "empty" ? {} : reason === "rpc" ? { rpc: { service: "demo.Rows", method: "Get" } } : undefined);
  if (reason === "resolver") host.invocation = { ...host.invocation, resolveSemantic: undefined };
  if (reason === "unresolved") host.resolveSemantic.mockReturnValue(undefined);
  if (reason === "capability") host.invocation = { ...host.invocation, capabilities: {} };
  if (reason === "policy") host.admit.mockReturnValue(false);
  host.mount(); await host.ready(); fireEvent.click(host.open());
  expect((await screen.findByRole("alert")).textContent).toMatch(/Action (denied|unavailable)/);
  expect(host.navigate).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
  expect(host.invoke).toHaveBeenCalledTimes(1);
});

it("serializes rows through canceled noncooperative settlement and returns keyboard-control focus", async () => {
  const host = setup(); let settle!: () => void;
  host.navigate.mockImplementation(() => new Promise<void>(resolve => { settle = resolve; }));
  host.mount(); await host.ready(); host.open().focus(); fireEvent.click(host.open());
  await waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(1));
  const signal = host.navigate.mock.calls[0]![2];
  const other = screen.getByRole("button", { name: "Open Records raw/e\u0301" });
  expect(other.hasAttribute("disabled")).toBe(true);
  const cancel = screen.getByRole("button", { name: "Cancel action" }); cancel.focus(); fireEvent.click(cancel);
  expect(signal.aborted).toBe(true); fireEvent.click(host.open()); fireEvent.click(screen.getByText("Second"));
  expect(host.navigate).toHaveBeenCalledTimes(1); expect(other.hasAttribute("disabled")).toBe(true);
  await act(async () => settle());
  await waitFor(() => expect(document.activeElement).toBe(host.open()));
  await waitFor(() => expect(other.hasAttribute("disabled")).toBe(false));
});

it("suppresses late completion after committed context replacement", async () => {
  const host = setup(); let settle!: () => void;
  host.navigate.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  host.mount(); await host.ready(); fireEvent.click(host.open());
  await waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(1));
  host.invocation = { ...host.invocation, context: { ...host.invocation.context!, currentResourcePath: "replacement" } }; host.update();
  expect(host.navigate.mock.calls[0]![2].aborted).toBe(true);
  await act(async () => settle()); expect(screen.queryByText("Action completed.")).toBeNull();
  fireEvent.click(host.open()); await waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(2));
  expect(host.navigate.mock.calls[1]![1]).toEqual({ ...host.invocation.context, selectedRow: host.rows[0] });
});

it("aborts unmounted rows and never replays a failed effect", async () => {
  const host = setup(); host.navigate.mockRejectedValueOnce(new Error("private route failure"));
  host.mount(); await host.ready(); fireEvent.click(host.open());
  expect((await screen.findByRole("alert")).textContent).toBe("Action failed. Try again with the current context.");
  expect(screen.queryByText(/private route/)).toBeNull();
  let settle!: () => void; host.navigate.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }));
  fireEvent.click(host.open()); await waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(2));
  host.unmount(); expect(host.navigate.mock.calls[1]![2].aborted).toBe(true);
  await act(async () => settle()); expect(host.navigate).toHaveBeenCalledTimes(2); expect(host.onAction).not.toHaveBeenCalled();
});

it("revalidates committed context after asynchronous semantic confirmation", async () => {
  const host = setup(); let consent!: (value: boolean) => void;
  const confirm = vi.fn(() => new Promise<boolean>(resolve => { consent = resolve; }));
  host.resolveSemantic.mockReturnValue({ affordance: fromJson(AffordanceSchema, { navigate: { route: "/safe" } }), confirm });
  host.mount(); await host.ready(); fireEvent.click(host.open());
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  host.invocation = { ...host.invocation, context: { ...host.invocation.context!, currentResourcePath: "changed-before-consent" } }; host.update();
  await act(async () => consent(true));
  expect(host.navigate).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
});

it("applies resolved row predicates rather than granting the implicit open action", async () => {
  const host = setup(); host.resolveSemantic.mockReturnValue({ affordance: fromJson(AffordanceSchema, {
    navigate: { route: "/safe" }, enabledWhen: { fieldPath: "active", equals: "true" },
  }) });
  host.mount(); await host.ready(); fireEvent.click(host.open());
  expect((await screen.findByRole("alert")).textContent).toContain("does not meet its conditions");
  expect(host.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open Records raw/e\u0301" }));
  await waitFor(() => expect(host.navigate).toHaveBeenCalledTimes(1));
  expect(host.navigate.mock.calls[0]![1]).toEqual({ ...host.invocation.context, selectedRow: host.rows[1] });
});

it("reports refresh failure without replaying navigation", async () => {
  const host = setup(); const refresh = vi.fn(async () => { throw new Error("private refresh error"); });
  host.invocation = { ...host.invocation, refresh };
  host.resolveSemantic.mockReturnValue({ affordance: fromJson(AffordanceSchema, { navigate: { route: "/safe" }, refreshOnSuccess: true }) });
  host.mount(); await host.ready(); fireEvent.click(host.open());
  expect((await screen.findByRole("status")).textContent).toContain("without repeating the action");
  expect(refresh).toHaveBeenCalledTimes(1); expect(host.navigate).toHaveBeenCalledTimes(1);
  expect(host.onAction).not.toHaveBeenCalled(); expect(screen.queryByText(/private refresh/)).toBeNull();
});

it("never evaluates an identifier accessor", () => {
  const getter = vi.fn(() => "getter"); const row = Object.defineProperty({}, "id", { get: getter, enumerable: true });
  render(<MeridianMuiProvider invoker={{ invoke: async () => ({}) }}>
    <table><tbody><AdmittedNavigationRow row={row} subjectKind="Records"><td>Row</td></AdmittedNavigationRow></tbody></table>
  </MeridianMuiProvider>);
  expect(screen.getByRole("button", { name: "Open row" }).hasAttribute("disabled")).toBe(true);
  expect(getter).not.toHaveBeenCalled();
});

it("does not invent entity navigation without a subject", async () => {
  const host = setup(); host.subjectKind = undefined; host.mount();
  fireEvent.click(await screen.findByText("Zero"));
  expect(screen.queryByRole("columnheader", { name: "Navigation" })).toBeNull();
  expect(host.resolveSemantic).not.toHaveBeenCalled(); expect(host.onAction).not.toHaveBeenCalled();
});

it("does not steal link or nested control gestures", () => {
  const navigate = vi.fn(), resolveSemantic = vi.fn();
  render(<MeridianMuiProvider invoker={{ invoke: async () => ({}) }} invocation={{ capabilities: { navigate }, resolveSemantic }}>
    <table><tbody><AdmittedNavigationRow row={{ id: "raw" }} subjectKind="Records">
      <td><a href="#link">Link</a><input aria-label="Selection" type="checkbox" /><button>Nested</button></td>
    </AdmittedNavigationRow></tbody></table>
  </MeridianMuiProvider>);
  fireEvent.click(screen.getByRole("link")); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Nested" }));
  expect(resolveSemantic).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
});

it.each([{}, { id: null }, { id: false }, { id: {} }, { id: "" }, Object.create({ id: "inherited" }) as object])("disables rows with no own supported identifier: %j", row => {
  const resolveSemantic = vi.fn();
  render(<MeridianMuiProvider invoker={{ invoke: async () => ({}) }} invocation={{ resolveSemantic }}>
    <table><tbody><AdmittedNavigationRow row={row as Record<string, unknown>} subjectKind="Records"><td>Row</td></AdmittedNavigationRow></tbody></table>
  </MeridianMuiProvider>);
  expect(screen.getByRole("button", { name: "Open row" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByText("Row")); expect(resolveSemantic).not.toHaveBeenCalled();
});
