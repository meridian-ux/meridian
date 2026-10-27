import { create, toBinary, toJson } from "@bufbuild/protobuf";
import { FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { expect, it } from "vitest";
import { readFrozen } from "../../../schemas/tests/frozen_affordance.js";
import { RETIRED_FORM, RETIRED_TABLE, withRetiredTrap } from "./retired_wire.js";

it("browser traps are exact historical bytes, retained but not revived by v1", () => {
  expect(RETIRED_TABLE).toEqual(toBinary(TablePanelSchema, readFrozen(TablePanelSchema,
    { actions: [{ label: "Legacy trap", rpc: { service: "legacy.Rows", method: "Delete" } }] })));
  expect(RETIRED_FORM).toEqual(toBinary(FormPanelSchema, readFrozen(FormPanelSchema,
    { submit: { service: "legacy.Forms", method: "Delete" } })));
  for (const arm of ["form", "table"] as const) {
    const panel = withRetiredTrap(create(PanelDescriptorSchema, { body: { case: arm, value: {} } }));
    if (panel.body.case === "form") expect(toBinary(FormPanelSchema, panel.body.value)).toEqual(RETIRED_FORM);
    else if (panel.body.case === "table") expect(toBinary(TablePanelSchema, panel.body.value)).toEqual(RETIRED_TABLE);
    else throw Error("Expected historical panel body");
    expect(toJson(PanelDescriptorSchema, panel)).toEqual({ [arm]: {} });
  }
});
