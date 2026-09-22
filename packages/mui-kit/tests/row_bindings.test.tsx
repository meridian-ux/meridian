import { create } from "@bufbuild/protobuf";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelRenderer, MeridianRowActionsContext } from "@savvifi/meridian-web-react";
import { ActionSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
for (const viewAction of [false, true]) for (const bound of [false, true]) for (const denied of [false, true]) {
  it(`resolves ${viewAction ? "view" : "panel"} row requests, bound=${bound}, denied=${denied}`, async () => {
    const requests: unknown[] = [];
    let reads = 0;
    const call = { service: "demo.Rows", method: "Save", bindings: bound ? [
      { requestField: "fixed", source: { case: "literal" as const, value: "yes" } },
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
    } }}><MeridianRowActionsContext.Provider value={viewAction ? [create(ActionSchema, { id: "run", label: "Run", call })] : []}>
      <PanelRenderer descriptor={descriptor} />
    </MeridianRowActionsContext.Provider></MeridianMuiProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Row actions" }));
    const action = await screen.findByRole("menuitem", { name: "Run" });
    fireEvent.click(action);
    if (denied) {
      expect(action.getAttribute("aria-disabled")).toBe("true");
      expect(requests).toEqual([]);
      expect(reads).toBe(1);
      return;
    }
    await waitFor(() => expect(requests).toEqual([bound ? { fixed: "yes", payload: { count: 0, active: false } } : { id: "row-1" }]));
    if (!viewAction) await waitFor(() => expect(reads).toBe(2));
  });
}
