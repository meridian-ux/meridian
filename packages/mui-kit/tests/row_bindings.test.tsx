import { create } from "@bufbuild/protobuf";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import {
  MeridianRowActionsContext,
  MeridianSelectionContext,
  PanelRenderer,
} from "@savvifi/meridian-web-react";
import { ActionSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
for (const viewAction of [false, true]) for (const bound of [false, true]) for (const denied of [false, true]) {
  it(`resolves ${viewAction ? "view" : "panel"} row requests, bound=${bound}, denied=${denied}`, async () => {
    const requests: unknown[] = [];
    let reads = 0;
    const call = { service: "demo.Rows", method: "Save", bindings: bound ? [
      { requestField: "fixed", source: { case: "literal" as const, value: "yes" } },
      { requestField: "scope", source: { case: "selectionKey" as const, value: "workspace" } },
      { requestField: "payload", source: { case: "nested" as const, value: { fields: [
        { requestField: "count", source: { case: "rowField" as const, value: "data.count" } },
        { requestField: "active", source: { case: "rowField" as const, value: "active" } },
      ] } } },
    ] : [] };
    const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: {
      populate: { service: "demo.Rows", method: "List" }, rowsField: "items",
      columns: [{ header: "Name", fieldPath: "id" }],
      actions: viewAction ? [] : [{ label: "Run", rpc: call, refreshOnSuccess: true }],
    } } });
    render(<MeridianMuiProvider admission={{ mutations: denied ? [] : ["*"] }} invoker={{ invoke: async (_s, method, request) => {
      if (method === "List") { reads++; return { items: [{ id: "row-1", data: { count: 0 }, active: false }] }; }
      requests.push(request); return {};
    } }}><MeridianSelectionContext.Provider value={{ values: { workspace: "alpha" }, set: () => {} }}>
      <MeridianRowActionsContext.Provider value={viewAction ? [create(ActionSchema, { id: "run", label: "Run", call })] : []}>
        <PanelRenderer descriptor={descriptor} />
      </MeridianRowActionsContext.Provider>
    </MeridianSelectionContext.Provider></MeridianMuiProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Row actions" }));
    const action = await screen.findByRole("menuitem", { name: "Run" });
    fireEvent.click(action);
    if (denied) {
      expect(action.getAttribute("aria-disabled")).toBe("true");
      expect(requests).toEqual([]);
      expect(reads).toBe(1);
      return;
    }
    await waitFor(() => expect(requests).toEqual([bound ? {
      fixed: "yes", scope: "alpha", payload: { count: 0, active: false },
    } : { id: "row-1" }]));
    if (!viewAction) await waitFor(() => expect(reads).toBe(2));
  });
}

it("disables a panel row action when enabled_when does not match the raw row", async () => {
  const requests: unknown[] = [];
  const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: {
    populate: { service: "demo.Rows", method: "List" }, rowsField: "items",
    columns: [{ header: "State", fieldPath: "state" }],
    actions: [{
      label: "Resolve",
      rpc: { service: "demo.Rows", method: "Resolve" },
      enabledWhen: { fieldPath: "state", equals: "OPEN" },
    }],
  } } });
  render(<MeridianMuiProvider admission={{ mutations: ["*"] }} invoker={{ invoke: async (_s, method, request) => {
    if (method === "List") return { items: [{ id: "row-1", state: "CLOSED" }] };
    requests.push(request); return {};
  } }}><PanelRenderer descriptor={descriptor} /></MeridianMuiProvider>);

  fireEvent.click(await screen.findByRole("button", { name: "Row actions" }));
  const action = await screen.findByRole("menuitem", { name: "Resolve" });
  expect(action.getAttribute("aria-disabled")).toBe("true");
  expect(action.getAttribute("title")).toBe("Unavailable for this row.");
  fireEvent.click(action);
  expect(requests).toEqual([]);
});

it("retries a failed matching row action and refreshes by default", async () => {
  const requests: unknown[] = [];
  let reads = 0;
  let attempts = 0;
  const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: {
    populate: { service: "demo.Rows", method: "List" }, rowsField: "items",
    columns: [{ header: "State", fieldPath: "state" }],
    actions: [{
      label: "Resolve",
      rpc: {
        service: "demo.Rows", method: "Resolve",
        bindings: [{ requestField: "active", source: { case: "rowField", value: "active" } }],
      },
      enabledWhen: { fieldPath: "state", equals: "OPEN" },
    }],
  } } });
  render(<MeridianMuiProvider admission={{ mutations: ["*"] }} invoker={{ invoke: async (_s, method, request) => {
    if (method === "List") { reads++; return { items: [{ id: "row-1", state: "OPEN", active: false }] }; }
    requests.push(request);
    attempts++;
    if (attempts === 1) throw new Error("upstream unavailable");
    return {};
  } }}><PanelRenderer descriptor={descriptor} /></MeridianMuiProvider>);

  fireEvent.click(await screen.findByRole("button", { name: "Row actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Resolve" }));
  expect((await screen.findByRole("alert")).textContent).toContain("upstream unavailable");
  expect(requests).toEqual([{ active: false }]);
  expect(reads).toBe(1);

  fireEvent.click(screen.getByRole("button", { name: "Row actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Resolve" }));
  await waitFor(() => expect(requests).toEqual([{ active: false }, { active: false }]));
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
