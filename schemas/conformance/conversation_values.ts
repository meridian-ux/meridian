// Runtime test scenarios over the existing string-value corpus. Serialized
// inputs remain canonical Block protobufs, not a parallel conversation DTO.
import { fromJson } from "@bufbuild/protobuf";
import { BlockSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import corpus from "./constrained_value_types.json";

export const CONVERSATION_VALUES = corpus.strings.map(entry => ({
  ...entry,
  // Conversation slots preserve an explicitly empty string; unlike read-only
  // panel values, they must not synthesize a missing-value dash.
  expected: entry.name === "empty" ? "" : entry.expected,
}));

export function conversationValueBlocks(entry: typeof CONVERSATION_VALUES[number]) {
  const display = { type: entry.type,
    ...(entry.digits === undefined ? {} : { number: { fractionDigits: entry.digits } }) };
  return [
    fromJson(BlockSchema, { fields: { fields: [{ key: "Value", value: entry.raw, display }] } }),
    fromJson(BlockSchema, { list: { items: [{ title: entry.raw, subtitle: entry.raw,
      titleDisplay: display, subtitleDisplay: display }] } }),
    fromJson(BlockSchema, { table: { columns: [{ key: "value" }], rows: [{
      cells: { value: "stale legacy cell" }, displayCells: { value: { value: entry.raw, display } },
    }] } }),
  ];
}
