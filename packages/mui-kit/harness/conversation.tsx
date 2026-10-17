// Host-owned rich-view adapter: actual Conversation SSE -> canonical descriptor
// -> shared ViewRenderer. The chat package remains independent of panel kits.
import { create, fromBinary, fromJson, toBinary, toJson, type JsonValue } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { createElement, useMemo } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { htmlKit, shadcnKit, MeridianProvider, ViewRenderer } from "@savvifi/meridian-web-react";
import { Conversation } from "../../chat/src/conversation.js";
import { CONVERSATION_CSS } from "../../chat/src/styles.js";
import type { ViewBlock } from "../../chat/src/wire.js";
import { muiKit } from "../src/mui_kit.js";

let mounted: Root | undefined;
let calls: string[] = [];
let denials = 0;
let pendingReads: Array<() => void> = [];
const struct = (bytes: number[]) => toJson(StructSchema, fromBinary(StructSchema, Uint8Array.from(bytes)));

function RichView({ wire, values }: { wire: ViewBlock; values: Record<string, string> }) {
  const view = useMemo(() => fromJson(ViewDescriptorSchema, wire as JsonValue), [wire]);
  return <ViewRenderer key={view.id} view={view} selection={{ values, set() {} }} />;
}

const controls = {
  calls: () => [...calls],
  denials: () => denials,
  releaseReads() { const pending = pendingReads; pendingReads = []; for (const resolve of pending) resolve(); },
  dispose() {
    if (mounted) { const previous = mounted; mounted = undefined; flushSync(() => previous.unmount()); }
  },
  mount(kit: string, contextBytes: number[], responseBytes: number[], allowExport = false, holdReads = false) {
    controls.dispose(); controls.releaseReads(); calls = []; denials = 0;
    const selected = kit === "html" ? htmlKit : kit === "shadcn" ? shadcnKit : kit === "mui-kit" ? muiKit : undefined;
    if (!selected) throw new Error(`Unknown conversation kit ${kit}`);
    const context = struct(contextBytes) as { selections?: Record<string, unknown> };
    const responses = struct(responseBytes) as Record<string, object>;
    const values = (context.selections ?? {}) as Record<string, string>;
    const invoker = { invoke: async (service: string, method: string) => {
      calls.push(`${service}.${method}`);
      if (holdReads) await new Promise<void>(resolve => pendingReads.push(resolve));
      return responses[`${service}.${method}`] ?? {};
    } };
    const root = createRoot(document.getElementById("root")!); mounted = root;
    flushSync(() => root.render(createElement(MeridianProvider, {
      kit: selected, invoker, adhoc: {},
      admission: { mutations: allowExport ? ["fixture.Layout/Export"] : [], onDenied: () => { denials++; } },
      children: createElement(Conversation, {
        sseUrl: "/events", turnUrl: "/turn", emptyState: "Waiting for fixture",
        renderView: wire => createElement(RichView, { wire, values }),
      }),
    })));
  },
  frame(bytes: number[], seq: string, blockId = "composed-view") {
    const view = fromBinary(ViewDescriptorSchema, Uint8Array.from(bytes));
    const event = create(ConversationEventSchema, {
      seq: BigInt(seq), event: { case: "block", value: { blockId, role: "assistant", kind: { case: "view", value: view } } },
    });
    return JSON.stringify(toJson(ConversationEventSchema, fromBinary(ConversationEventSchema, toBinary(ConversationEventSchema, event))));
  },
};
const style = document.createElement("style"); style.textContent = CONVERSATION_CSS; document.head.append(style);
declare global { interface Window { conversationConformance: typeof controls } }
window.conversationConformance = controls;
