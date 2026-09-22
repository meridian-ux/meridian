// Conversation SSE carries proto3 JSON, while the shared formatter consumes
// decoded messages. Keep this conversion at one boundary for both web tiers.
import { fromJson } from "@bufbuild/protobuf";
import { ValueDisplaySchema, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { formatByDisplay, type DisplayedValue } from "@savvifi/meridian-schemas/uiview";
import type { Field } from "./wire.js";

export function displayField(field: Field): DisplayedValue {
  const text = field.value ?? "";
  if (!field.display) return { text };
  try {
    const display = fromJson(ValueDisplaySchema, field.display, { ignoreUnknownFields: true });
    if (!text || ![ValueType.DATE, ValueType.DATE_TIME, ValueType.TIME,
      ValueType.PRINCIPAL, ValueType.EMAIL].includes(display.type)) return { text };
    // Fields retain their string wire representation: numeric-looking values
    // are never parsed, and this surface has no clock or route resolver.
    return formatByDisplay(text, display);
  } catch {
    // A malformed/forward-version display must not discard the streamed value.
    return { text };
  }
}
