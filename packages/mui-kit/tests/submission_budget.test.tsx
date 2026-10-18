import { create } from "@bufbuild/protobuf";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, startTransition, Suspense, useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

function descriptor(kind: "form" | "lro", scope: string) {
  const call = { service: "demo.Inputs", method: "Submit", bindings: [{ requestField: "scope", source: { case: "literal" as const, value: scope } }] };
  const fields = [{ fieldId: "text", requestField: "request.text", label: "Text", kind: { case: "text" as const, value: { defaultValue: "first" } } }];
  return create(PanelDescriptorSchema, { body: kind === "form" ? { case: "form", value: { mode: 2, submit: call, fields } }
    : { case: "lro", value: { start: call, inputs: fields } } });
}

describe("MUI submission boundary", () => {
  for (const kind of ["form", "lro"] as const) {
    it(`${kind}: a suspended replacement does not strand the committed submission`, async () => {
      const panel = descriptor(kind, "scope");
      let replace!: () => void;
      let finish!: (value: object) => void;
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
          <MeridianMuiProvider invoker={replacement ? next : old} admission={{ mutations: ["demo.Inputs/Submit"] }}>
            <PanelRenderer descriptor={panel} /><Hold replacement={replacement} />
          </MeridianMuiProvider>
        </Suspense>;
      }
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: kind === "form" ? /Save/ : /Run/ }));
      await act(async () => startTransition(replace));
      expect(suspended).toBe(true);
      expect(screen.queryByText("Replacement loading")).toBeNull();
      await act(async () => finish(kind === "lro" ? { done: true, response: {} } : {}));
      expect((screen.getByRole("button", { name: kind === "form" ? /Save/ : /Run/ }) as HTMLButtonElement).disabled).toBe(false);
      if (kind === "lro") expect(screen.getByText("Done.")).toBeTruthy();
      else expect(screen.getByRole("status").textContent).toBe("Action completed.");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it(kind === "form" ? "form: retains input while oversized declarations remain rejected on smaller retry"
      : "lro: retains oversized input on rejection and permits a smaller retry", async () => {
      const panel = descriptor(kind, "s".repeat(400_000));
      const invoke = vi.fn<RpcInvoker["invoke"]>(async () => kind === "lro" ? { done: true, response: {} } : {});
      render(<MeridianMuiProvider invoker={{ invoke }} admission={{ mutations: ["demo.Inputs/Submit"] }}><PanelRenderer descriptor={panel} /></MeridianMuiProvider>);
      const input = screen.getByLabelText("Text") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "v".repeat(400_000) } });
      fireEvent.click(screen.getByRole("button", { name: kind === "form" ? /Save/ : /Run/ }));
      expect((await screen.findByRole("alert")).textContent).toBe(kind === "form" ? "Action failed. Try again with the current context." : "Submission failed. Try again.");
      expect(invoke).not.toHaveBeenCalled();
      expect(input.value).toHaveLength(400_000);
      fireEvent.change(input, { target: { value: "smaller" } });
      fireEvent.click(screen.getByRole("button", { name: kind === "form" ? /Save/ : /Run/ }));
      if (kind === "form") {
        // A smaller value cannot make a 400 KB literal RpcCall fit the
        // unchanged native 64 KiB declaration boundary. Runtime-data work
        // accounting and successful smaller retry are tested independently.
        expect((await screen.findByRole("alert")).textContent).toContain("Action failed");
        expect(invoke).not.toHaveBeenCalled(); expect(input.value).toBe("smaller");
        return;
      }
      await waitFor(() => expect((screen.getByRole("button", { name: /Run/ }) as HTMLButtonElement).disabled).toBe(false));
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0][2]).toMatchObject({ request: { text: "smaller" } });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it(`${kind}: suppresses duplicate pending submits and isolates obsolete failures`, async () => {
      const panel = descriptor(kind, "scope");
      let rejectOld!: (reason: Error) => void;
      const invoke = vi.fn<RpcInvoker["invoke"]>(() => new Promise((_, reject) => { rejectOld = reject; }));
      const tree = (transport: RpcInvoker) => <MeridianMuiProvider invoker={transport} admission={{ mutations: ["demo.Inputs/Submit"] }}><PanelRenderer descriptor={panel} /></MeridianMuiProvider>;
      const view = render(tree({ invoke }));
      const button = screen.getByRole("button", { name: kind === "form" ? /Save/ : /Run/ }) as HTMLButtonElement;
      fireEvent.click(button); fireEvent.click(button);
      expect(invoke).toHaveBeenCalledOnce();
      if (kind === "form") { expect(button.getAttribute("aria-disabled")).toBe("true"); expect(button.disabled).toBe(false); }
      else expect(button.disabled).toBe(true);
      view.rerender(tree({ invoke: async () => ({}) }));
      await act(async () => rejectOld(new Error("obsolete private failure")));
      expect(screen.queryByRole("alert")).toBeNull();
      expect((screen.getByRole("button", { name: kind === "form" ? /Save/ : /Run/ }) as HTMLButtonElement).disabled).toBe(false);
    });
  }

  it("reports a denied no-input LRO as denied without reaching transport", async () => {
    const panel = create(PanelDescriptorSchema, { body: { case: "lro", value: { start: { service: "demo.Inputs", method: "Start" } } } });
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({}));
    const onDenied = vi.fn();
    render(<MeridianMuiProvider invoker={{ invoke }} admission={{ onDenied }}><PanelRenderer descriptor={panel} /></MeridianMuiProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Submission is not permitted.");
    expect(invoke).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledOnce();
  });

  it("maps nested LRO paths and applies automatic inputs after explicit bindings", async () => {
    const panel = create(PanelDescriptorSchema, { body: { case: "lro", value: {
      start: { service: "demo.Inputs", method: "Start", bindings: [
        { requestField: "request.name", source: { case: "literal", value: "bound" } },
        { requestField: "copy", source: { case: "formField", value: "name" } },
      ] }, inputs: [
        { fieldId: "name", requestField: "request.name", label: "Name", kind: { case: "text", value: { defaultValue: "001.20" } } },
        { fieldId: "count", requestField: "counter.count", label: "Count", kind: { case: "integer", value: { defaultValue: 0 } } },
        { fieldId: "outer", requestField: "config", label: "Outer", kind: { case: "nested", value: { fields: [
          { fieldId: "flag", requestField: "data.flag", label: "Flag", kind: { case: "boolean", value: { defaultValue: false } } },
        ] } } },
      ],
    } } });
    const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({ done: true, response: {} }));
    render(<MeridianMuiProvider invoker={{ invoke }} admission={{ mutations: ["demo.Inputs/Start"] }}><PanelRenderer descriptor={panel} /></MeridianMuiProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Done.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("demo.Inputs", "Start", {
      request: { name: "001.20" }, copy: "001.20", counter: { count: 0 }, config: { data: { flag: false } },
    });
  });
});
