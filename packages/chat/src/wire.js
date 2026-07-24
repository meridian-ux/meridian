// The conversation wire shape — the proto3-JSON of meridian.ui.v1.ConversationEvent
// (conversation.proto in meridian-schemas, the neutral promotion of botnoc chat.v1).
//
// These are STRUCTURAL types (not the protobuf-es messages) so the renderer has no
// protobuf-es runtime dependency and the web-component bundle stays tiny. They are
// kept byte-aligned to the canonical proto by a conformance test that feeds real
// `toJson(ConversationEventSchema, …)` output through the model. Field names are
// the proto3-JSON localNames (camelCase); `seq` may arrive as a number (botnoc's
// hand-built JSON) or a string (canonical proto3-JSON for uint64).
/** Whether a status is a live (shown) indicator vs cleared/idle. */
export function isActiveStatus(state) {
    return state === "THINKING" || state === "WORKING";
}
