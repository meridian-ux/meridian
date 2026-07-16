import { create, toJson } from "@bufbuild/protobuf";

import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";

import type { ConversationEvent } from "../src/wire.js";

/**
 * A real canonical proto `meridian.ui.v1.ConversationEvent`, serialized to
 * proto3-JSON and typed as meridian-chat's STRUCTURAL wire type. The cast only
 * type-checks because the structural types agree with the proto's proto3-JSON
 * (event oneof → `block`, block kind oneof → `markdown`, uint64 seq → string) —
 * so this is the conformance bridge that keeps wire.ts aligned to the proto.
 */
export function conformanceMarkdownEvent(): ConversationEvent {
  const msg = create(ConversationEventSchema, {
    seq: 1n,
    event: {
      case: "block",
      value: {
        blockId: "m1",
        role: "assistant",
        kind: { case: "markdown", value: { text: "hello **world**" } },
      },
    },
  });
  return toJson(ConversationEventSchema, msg) as unknown as ConversationEvent;
}
