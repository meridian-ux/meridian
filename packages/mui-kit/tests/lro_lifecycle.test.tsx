import { create } from "@bufbuild/protobuf";
import { act } from "react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { MeridianRowActionsContext, PanelRenderer } from "@savvifi/meridian-web-react";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
function fixture(inputs = true) {
  return create(PanelDescriptorSchema, { body: { case: "lro", value: {
    start: { service: "demo.Jobs", method: "Start" },
    inputs: inputs ? [{ fieldId: "value", label: "Raw input", kind: { case: "text", value: { defaultValue: "001.20" } } }] : [],
    finalize: { service: "demo.Jobs", method: "Finalize", bindings: [{ requestField: "token", source: { case: "rowField", value: "token" } }] },
    result: { rowsField: "items", columns: [{ header: "Result", fieldPath: "name" }], populate: { service: "must.not", method: "Read" } },
  } } });
}

it.each([false, true])("MUI renders polled/finalized results with inputs=%s and suppresses pending duplicates", async inputs => {
  let finish!: (value: object) => void;
  const invoke = vi.fn(async (_s: string, method: string, _request: object) => method === "Start" ? { name: "operations/mui", done: false }
    : method === "WaitOperation" ? new Promise<object>(resolve => { finish = resolve; }) : { items: [{ name: "MUI completed result" }] });
  render(<MeridianMuiProvider invoker={{ invoke }} admission={{ mutations: ["demo.Jobs/Start", "demo.Jobs/Finalize"] }}>
    <MeridianRowActionsContext.Provider value={[create(AffordanceSchema, { id: "forbidden", label: "Not a result action", invoke: { case: "rpc", value: { service: "must.not", method: "Mutate" } } })]}>
      <PanelRenderer descriptor={fixture(inputs)} />
    </MeridianRowActionsContext.Provider>
  </MeridianMuiProvider>);
  const run = screen.getByRole("button", { name: "Run" }) as HTMLButtonElement;
  fireEvent.click(run); fireEvent.click(run);
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(run.disabled).toBe(true);
  expect(screen.queryByText("Done.")).toBeNull();
  await act(async () => finish({ name: "operations/mui", done: true, response: { token: "raw-token" } }));
  expect(invoke).toHaveBeenCalledTimes(3);
  expect(invoke).toHaveBeenNthCalledWith(1, "demo.Jobs", "Start", inputs ? { value: "001.20" } : {});
  expect(invoke).toHaveBeenLastCalledWith("demo.Jobs", "Finalize", { token: "raw-token" });
  expect(screen.getByRole("table").textContent).toContain("MUI completed result");
  expect(screen.queryByRole("button", { name: /actions/i })).toBeNull();
  expect(screen.getByText("Done.")).toBeTruthy();
  expect(run.disabled).toBe(false);
});

it("MUI finalization is separately admitted and denied without backend work", async () => {
  const onDenied = vi.fn();
  const invoke = vi.fn(async () => ({ name: "operations/mui", done: true, response: { token: "raw" } }));
  render(<MeridianMuiProvider invoker={{ invoke }} admission={{ mutations: ["demo.Jobs/Start"], reads: ["demo.Jobs/Finalize"], onDenied }}><PanelRenderer descriptor={fixture()} /></MeridianMuiProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Submission is not permitted.");
  expect(invoke).toHaveBeenCalledOnce();
  expect(onDenied).toHaveBeenCalledWith(expect.objectContaining({ tier: "mutation", method: "Finalize" }));
  expect((screen.getByLabelText("Raw input") as HTMLInputElement).value).toBe("001.20");
  expect(screen.queryByRole("table")).toBeNull();
});

it("MUI cannot publish a finalized result after unmount", async () => {
  let finish!: (value: object) => void;
  const invoke = vi.fn(async (_s: string, method: string) => method === "Start" ? { name: "operations/mui", done: true, response: {} }
    : new Promise<object>(resolve => { finish = resolve; }));
  const view = render(<MeridianMuiProvider invoker={{ invoke }} admission={{ mutations: ["demo.Jobs/Start", "demo.Jobs/Finalize"] }}><PanelRenderer descriptor={fixture()} /></MeridianMuiProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  view.unmount(); await act(async () => finish({ items: [{ name: "obsolete" }] }));
  expect(view.container.textContent).toBe("");
  expect(invoke).toHaveBeenCalledTimes(2);
});
