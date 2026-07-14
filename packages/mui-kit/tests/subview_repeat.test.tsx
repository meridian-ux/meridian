// sub_view repeater, end-to-end through the MUI kit: a Slot with sub_view +
// sub_view_populate renders the sub_view once PER ROW, and panels inside each
// repeated sub_view with NO populate bind to that row (the ambient record) —
// DetailHeader shows the row's title/subtitle, a nested Table shows the row's
// steps. This is the real proof of record-scoping (html/shadcn are stubs).

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DetailHeaderPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { type ViewDescriptor, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { ViewRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

const invoker: RpcInvoker = {
  invoke: async (_service, method) => {
    if (method === "get-plan") {
      return {
        flows: [
          { title: "Flow A", actor: "admin", steps: [{ label: "open the app root" }, { label: "assert visible" }] },
          { title: "Flow B", actor: "member", steps: [{ label: "submit the form" }] },
        ],
      };
    }
    return {};
  },
};

// Per-flow sub_view: a DetailHeader bound to the flow row + a record-scoped steps table.
const flowTemplate: ViewDescriptor = create(ViewDescriptorSchema, {
  id: "flow",
  kind: ViewKind.DETAIL,
  layout: { mode: { case: "stacked", value: {} } },
  slots: [
    {
      id: "flow-header",
      role: "content",
      position: 0,
      panel: create(PanelDescriptorSchema, {
        panelId: "flow-header",
        // no populate → binds to the ambient record (the flow row)
        body: { case: "detailHeader", value: create(DetailHeaderPanelSchema, { titleSourcePath: "title", subtitleSourcePath: "actor" }) },
      }),
    },
    {
      id: "flow-steps",
      role: "content",
      position: 1,
      panel: create(PanelDescriptorSchema, {
        panelId: "flow-steps",
        // no populate → rows from the ambient record's `steps`
        body: { case: "table", value: create(TablePanelSchema, { rowsField: "steps", placeholder: "no steps", columns: [{ header: "Step", fieldPath: "label" }] }) },
      }),
    },
  ],
});

const planView: ViewDescriptor = create(ViewDescriptorSchema, {
  id: "plan",
  title: "Plan",
  kind: ViewKind.DETAIL,
  layout: { mode: { case: "stacked", value: {} } },
  slots: [
    {
      id: "flows",
      role: "content",
      position: 0,
      subView: flowTemplate,
      subViewPopulate: create(RpcCallSchema, { service: "aion.e2e", method: "get-plan" }),
      subViewRowsField: "flows",
    },
  ],
});

describe("sub_view repeater (record-scoped, MUI kit)", () => {
  it("renders one sub_view per row, each bound to its row", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={planView} />
      </MeridianMuiProvider>,
    );
    // DetailHeader per flow (title + subtitle from each row):
    await screen.findByText("Flow A");
    await screen.findByText("Flow B");
    await screen.findByText("admin");
    await screen.findByText("member");
    // record-scoped steps tables (rows from each row's `steps` field):
    await screen.findByText("open the app root");
    await screen.findByText("assert visible");
    await screen.findByText("submit the form");
  });
});
