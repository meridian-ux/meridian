import { create, toJson } from "@bufbuild/protobuf";

import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";

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

/**
 * The same conformance bridge for the `view` arm added in schemas 0.21.0.
 *
 * This is the reason the proto-ts devDependency moved from `^0.13.0` to an exact
 * `0.21.0`: at 0.13 the generated `Block` had no `view` case at all, so
 * `wire.ts`'s `view?: ViewBlock` was an unchecked claim about a proto this repo
 * could not see. Building one with the REAL generated types and casting it to the
 * structural type is what turns that claim into something the compiler and the
 * test suite enforce.
 *
 * Note the descriptor is built through `ViewDescriptorSchema` rather than written
 * as a literal — a hand-written object would prove only that our own guess
 * round-trips, which is precisely the mistake `wire.ts` exists to avoid.
 */
export function conformanceViewEvent(): ConversationEvent {
  const view = create(ViewDescriptorSchema, {
    id: "demo",
    title: "Demo",
    layout: { mode: { case: "stacked", value: {} } },
    slots: [
      {
        id: "slot-1",
        panel: {
          panelId: "kpi",
          title: "Passing runs",
          body: { case: "stat", value: { label: "Green", value: 42, unit: "runs" } },
        },
      },
    ],
  });

  const msg = create(ConversationEventSchema, {
    seq: 2n,
    event: {
      case: "block",
      value: {
        blockId: "v1",
        role: "assistant",
        kind: { case: "view", value: view },
      },
    },
  });
  return toJson(ConversationEventSchema, msg) as unknown as ConversationEvent;
}
