/** Exact runtime deduplication key for canonical uint64 proto-JSON sequences.
 * Safe legacy numeric IDs are accepted. Malformed or already-rounded numeric
 * inputs have no key: do not let them suppress a different valid event.
 * This does not decode or replace the canonical ConversationEvent wire type.
 */
export function conversationSequenceKey(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return undefined;
  const key = value.replace(/^0+(?=\d)/, "");
  const max = "18446744073709551615";
  return key.length < max.length || (key.length === max.length && key <= max) ? key : undefined;
}
