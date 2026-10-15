// Canonical protobuf fixture shared by browser prompt interaction tests.
import { create, fromJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";

export function promptFixture(confirmation = false) {
  return create(PanelDescriptorSchema, { panelId: "collect", title: "Collect parameters", body: { case: "prompt", value: {
    description: "Parameters stay local", detail: "Literal <script> detail\nsecond line", isConfirmation: confirmation,
    fields: [
      { fieldId: "text", requestField: "rpc_only", label: "Text", kind: { case: "text", value: { defaultValue: "Keep this", minLength: 2 } } },
      { fieldId: "empty", label: "Empty", kind: { case: "text", value: {} } },
      { fieldId: "integer", label: "Integer", kind: { case: "integer", value: { defaultValue: 0, min: -2, max: 2 } } },
      { fieldId: "number", label: "Decimal", kind: { case: "number", value: { defaultValue: -1.5 } } },
      { fieldId: "boolean", label: "Boolean", kind: { case: "boolean", value: { defaultValue: false } } },
      { fieldId: "enum", label: "Choice", kind: { case: "enumSelection", value: { options: [{ value: "token", label: "Shown label" }], defaultValue: "token" } } },
      { fieldId: "masked", label: "Secret", kind: { case: "masked", value: { defaultValue: "secret", pattern: "^[a-z]+$" } } },
      { fieldId: "nested", label: "Record", kind: { case: "nested", value: { fields: [{ fieldId: "name", label: "Name", kind: { case: "text", value: { defaultValue: "Ada" } } }] } } },
      { fieldId: "items", label: "Items", kind: { case: "repeated", value: { minItems: 1, maxItems: 2, element: { case: "scalar", value: { fieldId: "item", label: "Item", kind: { case: "number", value: { defaultValue: 1.5 } } } } } } },
      { fieldId: "map", label: "Map", kind: { case: "keyValueMap", value: {} } },
    ],
  } } });
}

export const expectedPromptValues = fromJson(StructSchema, {
  text: "Keep this", empty: "", integer: 0, number: -1.5, boolean: false,
  enum: "token", masked: "secret", nested: { name: "Ada" }, items: [1.5], map: {},
});
