// Host-owned rich-view adapter: actual Conversation SSE -> canonical descriptor
// -> shared ViewRenderer. The chat package remains independent of panel kits.
import { create, fromBinary, fromJson, toBinary, toJson, type JsonValue, type JsonObject } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { InvocationHost, RenderContext } from "@savvifi/meridian-schemas/uiview";
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
// Runtime fixture instrumentation; descriptors still use canonical proto wire,
// and requests/context retain the established host JSON seam. No audit DTO.
let effects: Array<{ kind: string; target: unknown; context?: RenderContext }> = [];
let effectSignals: AbortSignal[] = [];
let pendingEffects: Array<() => void> = [];
let refreshes = 0;
type UnifiedMode = "allow" | "deny" | "missing" | "pending" | "fail";
type TargetKind = "rpc" | "uri" | "command" | "navigate" | "openPanel" | "openView" | "copy";
const struct = (bytes: number[]) => toJson(StructSchema, fromBinary(StructSchema, Uint8Array.from(bytes)));

function RichView({ wire, values }: { wire: ViewBlock; values: Record<string, string> }) {
  const view = useMemo(() => fromJson(ViewDescriptorSchema, wire as JsonValue), [wire]);
  return <ViewRenderer key={view.id} view={view} selection={{ values, set() {} }} />;
}

const controls = {
  calls: () => [...calls],
  denials: () => denials,
  effects: () => effects,
  aborted: () => effectSignals.map(signal => signal.aborted),
  refreshes: () => refreshes,
  releaseEffects() { const pending = pendingEffects; pendingEffects = []; for (const resolve of pending) resolve(); },
  releaseReads() { const pending = pendingReads; pendingReads = []; for (const resolve of pending) resolve(); },
  dispose() {
    if (mounted) { const previous = mounted; mounted = undefined; flushSync(() => previous.unmount()); }
  },
  mount(kit: string, contextBytes: number[], responseBytes: number[], allowExport = false, holdReads = false, unifiedMode?: UnifiedMode) {
    controls.dispose(); controls.releaseReads(); controls.releaseEffects(); calls = []; denials = 0; effects = []; effectSignals = []; refreshes = 0;
    const selected = kit === "html" ? htmlKit : kit === "shadcn" ? shadcnKit : kit === "mui-kit" ? muiKit : undefined;
    if (!selected) throw new Error(`Unknown conversation kit ${kit}`);
    const context = struct(contextBytes) as { selections?: Record<string, unknown> };
    const responses = struct(responseBytes) as Record<string, object>;
    const values = (context.selections ?? {}) as Record<string, string>;
    const invocationContext: RenderContext = { currentResourcePath: "chat/raw", uiIdentity: null,
      selectedRow: { id: 0, flag: false }, formValues: { name: "raw/e\u0301" } };
    let failNext = unifiedMode === "fail";
    const effect = async (kind: string, target: unknown, current: RenderContext | undefined, signal: AbortSignal) => {
      effects.push({ kind, target, context: current }); effectSignals.push(signal);
      if (failNext) { failNext = false; throw Error("private chat fixture failure"); }
      if (unifiedMode === "pending") await new Promise<void>(resolve => pendingEffects.push(resolve));
    };
    const invocation: InvocationHost | undefined = unifiedMode ? { context: invocationContext,
      admit: () => unifiedMode !== "deny", refresh: async () => { refreshes++; },
      capabilities: unifiedMode === "missing" ? {} : {
        uri: (target, current, signal) => effect("uri", target, current, signal),
        command: (target, current, signal) => effect("command", target, current, signal),
        navigate: (target, current, signal) => effect("navigate", target, current, signal),
        openPanel: (target, current, signal) => effect("openPanel", target, current, signal),
        openView: (target, current, signal) => effect("openView", target, current, signal),
        copy: (target, current, signal) => effect("copy", target, current, signal),
        rpc: { invoke: async (service, method, request, signal) => {
          await effect("rpc", { service, method, request }, undefined, signal); return {};
        } },
      },
    } : undefined;
    const invoker = { invoke: async (service: string, method: string) => {
      calls.push(`${service}.${method}`);
      if (holdReads) await new Promise<void>(resolve => pendingReads.push(resolve));
      return responses[`${service}.${method}`] ?? {};
    } };
    const root = createRoot(document.getElementById("root")!); mounted = root;
    flushSync(() => root.render(createElement(MeridianProvider, {
      kit: selected, invoker, adhoc: {},
      admission: unifiedMode ? { reads: [], mutations: unifiedMode === "deny" ? [] : ["fixture.Chat/Get"], onDenied: () => { denials++; } }
        : { mutations: allowExport ? ["fixture.Layout/Export"] : [], onDenied: () => { denials++; } },
      invocation,
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
  canonicalFrame(kind: TargetKind | "empty" | "empty-target" | "unsafe", seq: string, replacement = false) {
    const targets: Record<TargetKind, JsonObject> = {
      rpc: { rpc: { service: "fixture.Chat", method: "Get", bindings: [
        { requestField: "id", rowField: "id" }, { requestField: "flag", rowField: "flag" }, { requestField: "name", formField: "name" },
      ] } }, uri: { uri: "/chat/raw" }, command: { command: "literal command, not clipboard" },
      navigate: { navigate: { route: "/chat/raw" } }, openPanel: { openPanel: { panelId: "chat-panel", title: "Inline panel" } },
      openView: { openView: "chat-view" }, copy: { copy: replacement ? "second/raw" : "first/e\u0301" },
    };
    const view = create(ViewDescriptorSchema, { id: "canonical-chat", title: replacement ? "Replacement chat view" : "Unified chat view",
      actions: [{ id: "legacy-trap", label: "Legacy trap", call: { service: "fixture.Legacy", method: "Delete" } }],
      affordances: { items: kind === "empty" ? [] : [fromJson(AffordanceSchema, { id: "same-control", label: "Unified action", description: "Typed chat host capability",
        ...(kind === "empty-target" ? {} : kind === "unsafe" ? { uri: "javascript:alert(1)" } : targets[kind]), refreshOnSuccess: true })] },
    });
    return controls.frame([...toBinary(ViewDescriptorSchema, view)], seq);
  },
};
const style = document.createElement("style"); style.textContent = CONVERSATION_CSS; document.head.append(style);
declare global { interface Window { conversationConformance: typeof controls } }
window.conversationConformance = controls;
