// Runtime test scenarios over the existing string-value corpus. Serialized
// inputs remain canonical Block protobufs, not a parallel conversation DTO.
import { fromBinary, fromJson, toJson } from "@bufbuild/protobuf";
import { BlockSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { FormattedValueSchema, ValueDisplaySchema, type ValueDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import corpus from "./constrained_value_types.json";
import options from "./core.json";

// In-memory authoring only. Serialized Block and display data stay protobufs.
type ConversationValueCase = {
  name: string; type: number; raw: string; expected: string; expectedTitle?: string; display: ValueDisplay;
};
const wire = (text: string) => Uint8Array.from(atob(text), byte => byte.charCodeAt(0));
export const CONVERSATION_VALUES: ConversationValueCase[] = [...corpus.strings.map(entry => ({
  ...entry,
  // Conversation slots preserve an explicitly empty string; unlike read-only
  // panel values, they must not synthesize a missing-value dash.
  expected: entry.name === "empty" ? "" : entry.expected,
  display: fromJson(ValueDisplaySchema, { type: entry.type,
    ...(entry.digits === undefined ? {} : { number: { fractionDigits: entry.digits } }) }),
})), ...options.valueFormats.flatMap(entry => {
  // A conversation slot is a string, not an unrestricted JSON/number value.
  // Do not stringify other payloads to make the formatter case fit this schema.
  if ("nowMs" in entry || typeof entry.input !== "string") return [];
  const display = fromBinary(ValueDisplaySchema, wire(entry.display));
  const expected = fromBinary(FormattedValueSchema, wire(entry.expected));
  const supported = entry.input !== "" && [8, 9, 10, 12, 13].includes(display.type);
  return [{ name: `option-${entry.name}`, type: display.type, raw: entry.input,
    expected: supported ? expected.text : entry.input,
    expectedTitle: supported ? expected.title : undefined, display }];
})];

export function conversationValueBlocks(entry: typeof CONVERSATION_VALUES[number]) {
  const display = toJson(ValueDisplaySchema, entry.display);
  return [
    fromJson(BlockSchema, { fields: { fields: [{ key: "Value", value: entry.raw, display }] } }),
    fromJson(BlockSchema, { list: { items: [{ title: entry.raw, subtitle: entry.raw,
      titleDisplay: display, subtitleDisplay: display }] } }),
    fromJson(BlockSchema, { table: { columns: [{ key: "value" }], rows: [{
      cells: { value: "stale legacy cell" }, displayCells: { value: { value: entry.raw, display } },
    }] } }),
  ];
}
