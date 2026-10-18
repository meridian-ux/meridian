// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, startTransition, Suspense, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ActionPlacement, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { AdmissionDenial, RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { MeridianRecordContext, ViewRenderer } from "@savvifi/meridian-web-react";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

const view = create(ViewDescriptorSchema, {
  id: "mui-admission-view",
  kind: ViewKind.LIST,
  layout: { mode: { case: "stacked", value: {} } },
  actions: [{
    id: "delete",
    label: "Delete",
    placement: ActionPlacement.HEADER,
    call: create(RpcCallSchema, { service: "demo.Orders", method: "DeleteOrder" }),
  }],
});

const overflowView = create(ViewDescriptorSchema, {
  id: "mui-admission-overflow-view",
  kind: ViewKind.LIST,
  layout: { mode: { case: "stacked", value: {} } },
  actions: [{
    id: "delete",
    label: "Delete",
    placement: ActionPlacement.OVERFLOW,
    call: create(RpcCallSchema, { service: "demo.Orders", method: "DeleteOrder" }),
  }],
});

describe("MUI admission boundary", () => {
  for (const overflow of [false, true]) {
    it(`resolves ${overflow ? "overflow" : "header"} bindings from real record and selection context`, async () => {
      const requestView = create(ViewDescriptorSchema, { id: "bound-actions", kind: ViewKind.LIST, actions: [{
        id: "run", label: "Run", placement: overflow ? ActionPlacement.OVERFLOW : ActionPlacement.HEADER,
        call: { service: "demo.Actions", method: "Run", bindings: [{ requestField: "payload", source: { case: "nested", value: { fields: [
          { requestField: "zero", source: { case: "rowField", value: "zero" } },
          { requestField: "no", source: { case: "rowField", value: "no" } },
          { requestField: "tenant", source: { case: "selectionKey", value: "tenant" } },
          { requestField: "empty", source: { case: "literal", value: "" } },
        ] } } }] },
      }] });
      const requests: object[] = [];
      render(<MeridianMuiProvider admission={{ mutations: ["demo.Actions/Run"] }} invoker={{ invoke: async (_s, _m, request) => { requests.push(request); return {}; } }}>
        <MeridianRecordContext.Provider value={{ zero: 0, no: false }}>
          <ViewRenderer view={requestView} selection={{ values: { tenant: "live" }, set: () => {} }} />
        </MeridianRecordContext.Provider>
      </MeridianMuiProvider>);
      if (overflow) fireEvent.click(screen.getByRole("button", { name: "more actions" }));
      fireEvent.click(screen.getByRole(overflow ? "menuitem" : "button", { name: "Run" }));
      await waitFor(() => expect(requests).toEqual([{ payload: { zero: 0, no: false, tenant: "live", empty: "" } }]));
    });

    it.each(["unsafe", "large", "cycle"])(`rejects %s ${overflow ? "overflow" : "header"} bindings before dispatch`, async mode => {
      const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
      const requestView = create(ViewDescriptorSchema, { id: "invalid-actions", kind: ViewKind.LIST, actions: [{
        id: "run", label: "Run", placement: overflow ? ActionPlacement.OVERFLOW : ActionPlacement.HEADER,
        call: { service: "demo.Actions", method: "Run", bindings: [
          { requestField: "safe", source: { case: "literal", value: "not sent alone" } },
          { requestField: mode === "unsafe" ? "__proto__.scope" : "payload", source: { case: "rowField", value: "payload" } },
        ] },
      }] });
      const requests: object[] = [];
      render(<MeridianMuiProvider admission={{ mutations: ["demo.Actions/Run"] }} invoker={{ invoke: async (_s, _m, request) => { requests.push(request); return {}; } }}>
        <MeridianRecordContext.Provider value={{ payload: mode === "cycle" ? cyclic : "x".repeat(800_000) }}><ViewRenderer view={requestView} /></MeridianRecordContext.Provider>
      </MeridianMuiProvider>);
      if (overflow) fireEvent.click(screen.getByRole("button", { name: "more actions" }));
      fireEvent.click(screen.getByRole(overflow ? "menuitem" : "button", { name: "Run" }));
      expect((await screen.findByRole("alert")).textContent).toContain("invalid or exceeds supported limits");
      expect(requests).toEqual([]);
    });
  }

  it("ignores a replaced header transport's obsolete failure", async () => {
    let rejectOld!: (error: Error) => void;
    const old: RpcInvoker = { invoke: () => new Promise((_, reject) => { rejectOld = reject; }) };
    const tree = (transport: RpcInvoker) => <MeridianMuiProvider invoker={transport} admission={{ mutations: ["*"] }}><ViewRenderer view={view} /></MeridianMuiProvider>;
    const mounted = render(tree(old));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    mounted.rerender(tree({ invoke: async () => ({}) }));
    rejectOld(new Error("obsolete failure"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the committed action live when a replacement render suspends without committing", async () => {
    let replace!: () => void;
    let finish!: (result: object) => void;
    let suspended = false;
    const never = new Promise<void>(() => {});
    const old: RpcInvoker = { invoke: () => new Promise(resolve => { finish = resolve; }) };
    const next: RpcInvoker = { invoke: async () => ({}) };
    function Hold({ replacement }: { replacement: boolean }) {
      if (replacement) { suspended = true; throw never; }
      return null;
    }
    function App() {
      const [replacement, setReplacement] = useState(false);
      replace = () => setReplacement(true);
      return <Suspense fallback={<p>Replacement loading</p>}>
        <MeridianMuiProvider invoker={replacement ? next : old} admission={{ mutations: ["*"] }}>
          <ViewRenderer view={view} /><Hold replacement={replacement} />
        </MeridianMuiProvider>
      </Suspense>;
    }
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => startTransition(replace));
    expect(suspended).toBe(true);
    expect(screen.queryByText("Replacement loading")).toBeNull();
    await act(async () => finish({}));
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("Action completed.");
  });

  it("blocks a header mutation before the invoker", async () => {
    const calls: string[] = [];
    const denials: AdmissionDenial[] = [];
    const invoker: RpcInvoker = {
      invoke: async (_service, method) => {
        calls.push(method);
        return {};
      },
    };
    render(
      <MeridianMuiProvider invoker={invoker} admission={{ onDenied: (denial) => denials.push(denial) }}>
        <ViewRenderer view={view} />
      </MeridianMuiProvider>,
    );

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("This action is unavailable.");
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByRole("status").id);
    await act(async () => fireEvent.click(button));

    expect(calls).toEqual([]);
    expect(denials).toMatchObject([{ tier: "mutation", service: "demo.Orders", method: "DeleteOrder" }]);
  });

  it("shows an unavailable note for a denied overflow mutation", async () => {
    const calls: string[] = [];
    const invoker: RpcInvoker = {
      invoke: async (_service, method) => {
        calls.push(method);
        return {};
      },
    };
    render(
      <MeridianMuiProvider invoker={invoker} admission={{}}>
        <ViewRenderer view={overflowView} />
      </MeridianMuiProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "more actions" }));
    const action = screen.getByRole("menuitem", { name: /Delete/ });
    expect(action.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("This action is unavailable.");
    expect(action.getAttribute("aria-describedby")).toBe(screen.getByRole("status").id);
    await act(async () => fireEvent.click(action));

    expect(calls).toEqual([]);
  });

  it("shows escaped failures, retries the same request, and prevents duplicate mutations", async () => {
    const calls: unknown[] = [];
    let finish: (() => void) | undefined;
    const invoker: RpcInvoker = { invoke: async (service, method, request) => {
      calls.push([service, method, request]);
      if (calls.length === 1) throw new Error("<b>Unavailable</b>");
      await new Promise<void>(resolve => { finish = resolve; });
      return {};
    } };
    render(<MeridianMuiProvider invoker={invoker} admission={{ mutations: ["*"] }}><ViewRenderer view={view} /></MeridianMuiProvider>);
    const button = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Action failed. Try again with the current context.");
    expect(alert.textContent).not.toContain("Unavailable");
    expect(alert.querySelector("b")).toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(calls).toEqual(Array(2).fill(["demo.Orders", "DeleteOrder", {}]));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    finish!();
    await waitFor(() => expect(button.hasAttribute("aria-busy")).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
