// Browser-safe historical bytes generated with the frozen additive descriptor
// (SHA-256 6dfcee54b85b39b59c4b1bb17d241a02eccfa37441d5c742db480b87c1e0a968).
// They deliberately survive as unknown fields in the removal reader.
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { FormPanelSchema, type PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";

export const RETIRED_TABLE = new Uint8Array([50,36,10,11,76,101,103,97,99,121,32,116,114,97,112,18,21,10,11,108,101,103,97,99,121,46,82,111,119,115,18,6,68,101,108,101,116,101]);
export const RETIRED_FORM = new Uint8Array([26,22,10,12,108,101,103,97,99,121,46,70,111,114,109,115,18,6,68,101,108,101,116,101]);

export function withRetiredTrap(panel: PanelDescriptor): PanelDescriptor {
  const body = panel.body;
  if (body.case === "table") Object.assign(body.value, fromBinary(TablePanelSchema,
    new Uint8Array([...toBinary(TablePanelSchema, body.value), ...RETIRED_TABLE])));
  else if (body.case === "form") Object.assign(body.value, fromBinary(FormPanelSchema,
    new Uint8Array([...toBinary(FormPanelSchema, body.value), ...RETIRED_FORM])));
  else throw Error("Historical trap requires a table or form");
  return panel;
}
