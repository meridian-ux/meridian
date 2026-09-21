// @vitest-environment jsdom

// KeyValueMapField renderer — add/edit/remove and submit round-trip.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  FormFieldSchema,
  KeyValueMapFieldSchema,
} from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { FormMode, FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { type ViewDescriptor, ViewDescriptorSchema, ViewKind } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { ViewRenderer } from "@savvifi/meridian-web-react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

function mapView(): ViewDescriptor {
  const panel = create(PanelDescriptorSchema, {
    panelId: "metadata-form",
    title: "Metadata",
    body: {
      case: "form",
      value: create(FormPanelSchema, {
        mode: FormMode.EDIT,
        itemNoun: "item",
        submit: create(RpcCallSchema, { service: "svc", method: "save" }),
        fields: [
          create(FormFieldSchema, {
            fieldId: "metadata",
            label: "Metadata",
            kind: {
              case: "keyValueMap",
              value: create(KeyValueMapFieldSchema, {
                keyLabel: "Name",
                valueLabel: "Value",
                addLabel: "Add metadata",
                maxItems: 2,
              }),
            },
          }),
        ],
      }),
    },
  });
  return create(ViewDescriptorSchema, {
    id: "map-detail",
    kind: ViewKind.DETAIL,
    layout: { mode: { case: "stacked", value: {} } },
    slots: [{ id: "main", role: "content", position: 0, panel }],
  });
}

describe("KeyValueMapField — MUI form round-trip", () => {
  it("adds, edits, bounds, removes, and submits map entries", () => {
    let request: unknown;
    const invoker: RpcInvoker = {
      invoke: async (_service, _method, req) => {
        request = req;
        return {};
      },
    };
    render(
      <MeridianMuiProvider invoker={invoker}>
        <ViewRenderer view={mapView()} />
      </MeridianMuiProvider>,
    );

    const add = screen.getByRole("button", { name: "Add metadata" });
    fireEvent.click(add);
    expect(screen.getAllByLabelText("Name")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "region" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "us-east" } });

    fireEvent.click(add);
    expect(screen.getAllByLabelText("Name")).toHaveLength(2);
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getAllByLabelText("Name")[1], { target: { value: "tier" } });
    fireEvent.change(screen.getAllByLabelText("Value")[1], { target: { value: "prod" } });

    fireEvent.click(screen.getAllByRole("button", { name: "remove entry" })[0]);
    expect(screen.getAllByLabelText("Name")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(request).toEqual({ metadata: { tier: "prod" } });
  });
});
