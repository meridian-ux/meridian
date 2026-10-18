import { toBinary } from "@bufbuild/protobuf";
import type { Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { Action } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { NormalizedAction } from "./action_normalization.js";
import { createAdmissionGate, type AdmissionPolicy } from "./admission.js";
import { matchesRowFilter } from "./affordance_predicate.js";
import { coreRequests } from "./core_runtime.js";
import type { RenderContext } from "./transport.js";

type Intent = Exclude<Affordance["invoke"], { case: undefined }>;
type Kind = Intent["case"];
type Target<K extends Kind> = Extract<Intent, { case: K }>["value"];

/** Runtime-only host callbacks, never a serialized capability/grant DTO. */
export type InvocationCapabilities = {
  [K in Exclude<Kind, "rpc">]?: (target: Target<K>, context: RenderContext, signal: AbortSignal) => Promise<void>;
} & {
  // Three-argument legacy transports remain assignable. Abort is best effort;
  // cancellation cannot undo a request already sent by such a transport.
  rpc?: { invoke(service: string, method: string, request: object, signal: AbortSignal): Promise<object> };
};

/** A pure host lookup, not the old executing onAction callback. A confirmation
 * is explicit host UI; true is consent only, never invocation admission. */
export interface SemanticResolution {
  readonly affordance: Affordance;
  readonly confirm?: (context: RenderContext, signal: AbortSignal) => Promise<boolean>;
}

/** Immutable, in-process activation scope owned by the renderer adapter.
 * readCurrent MUST return the same object while current, and replace it on any
 * descriptor, row/subject, form, selection, identity, policy, capability, or
 * resolver change. Neither it nor its nested values may be mutated in place.
 * Unmount returns undefined. This lifecycle contract is required for adoption;
 * a retained click closure or a newly allocated object on every read is wrong.
 * No snapshot is serialized, cached on disk, or used as an audit record.
 */
export interface InvocationSnapshot {
  readonly action: NormalizedAction;
  readonly context: RenderContext;
  readonly subject?: Readonly<{ entityType?: string; entityId?: string | number }>;
  readonly admission?: AdmissionPolicy;
  readonly capabilities: InvocationCapabilities;
  readonly admit?: (intent: Intent, context: RenderContext) => boolean;
  readonly resolveSemantic?: (action: Action, context: RenderContext,
    subject: InvocationSnapshot["subject"]) => SemanticResolution | undefined;
  readonly refresh?: (signal: AbortSignal) => Promise<void>;
}

export type InvocationDenial = "missing-target" | "unsupported-target" | "missing-resolver"
  | "unresolved-action" | "disabled" | "missing-capability" | "mutation-policy" | "target-policy";

/** Sanitized runtime result. Never include bound values, raw target strings,
 * clipboard payloads, thrown transport errors, or a host's confirmation text. */
export type InvocationOutcome =
  | { status: "denied"; reason: InvocationDenial }
  | { status: "succeeded"; refresh: "not-requested" | "succeeded" | "failed" }
  | { status: "busy" | "cancelled" | "stale" | "failed" };

class Stopped extends Error {
  constructor(readonly status: "cancelled" | "stale") { super(status); }
}
class Denied extends Error {
  constructor(readonly reason: InvocationDenial) { super(reason); }
}

/** One dispatcher per logical control. Constructing/reading it is pure: no
 * resolver, confirmation, policy, request building, or capability runs before
 * activate(). All seven targets share this path; there is no legacy fallback.
 */
export function createInvocationDispatcher(readCurrent: () => InvocationSnapshot | undefined) {
  let active: AbortController | undefined;
  let disposed = false;

  async function activate(): Promise<InvocationOutcome> {
    if (disposed) return { status: "cancelled" };
    if (active) return { status: "busy" };
    const controller = new AbortController();
    active = controller;
    const signal = controller.signal;
    let snapshot: InvocationSnapshot | undefined;
    try {
      snapshot = readCurrent();
      if (!snapshot) return { status: "stale" };
      const current = () => {
        const latest = readCurrent();
        if (signal.aborted || disposed) throw new Stopped("cancelled");
        if (latest !== snapshot) throw new Stopped("stale");
      };
      current();
      let affordance = snapshot.action.affordance;
      if (snapshot.action.semanticAction !== undefined) {
        if (!snapshot.action.semanticAction.id) throw new Denied("missing-target");
        if (!snapshot.resolveSemantic) throw new Denied("missing-resolver");
        const resolution = snapshot.resolveSemantic(snapshot.action.semanticAction, snapshot.context, snapshot.subject);
        current();
        if (!resolution) throw new Denied("unresolved-action");
        affordance = resolution.affordance;
        if (resolution.confirm) {
          const confirmed = await resolution.confirm(snapshot.context, signal);
          current();
          if (confirmed !== true) return { status: "cancelled" };
        }
      }
      const intent = affordance.invoke;
      if (intent.case === undefined) throw new Denied("missing-target");
      // Unknown wire fields decode to no arm; retain a defensive runtime check
      // for JS hosts that bypass protobuf decoding with a cast/plain object.
      if (!["rpc", "uri", "command", "navigate", "openPanel", "openView", "copy"].includes(intent.case)) {
        throw new Denied("unsupported-target");
      }
      if (affordance.enabledWhen && !matchesRowFilter(affordance.enabledWhen, snapshot.context.selectedRow)) {
        throw new Denied("disabled");
      }
      const capabilities = snapshot.capabilities;
      if (!capabilities[intent.case]) throw new Denied("missing-capability");
      if (intent.case === "rpc") {
        const call = intent.value;
        if (!call.service || !call.method) throw new Denied("missing-target");
        // Never infer this tier from a method name, descriptor, or placement.
        try {
          createAdmissionGate(snapshot.admission).check("mutation", call.service, call.method);
        } catch {
          throw new Denied("mutation-policy");
        }
      } else if ((typeof intent.value === "string" && intent.case !== "copy" && !intent.value)
        || (intent.case === "navigate" && !intent.value.route)) {
        throw new Denied("missing-target");
      }
      // Non-RPC targets have no default grant. A host may apply a stricter
      // contextual rule to RPCs too, but cannot replace mutation admission.
      if (snapshot.admit ? snapshot.admit(intent, snapshot.context) !== true : intent.case !== "rpc") {
        throw new Denied("target-policy");
      }
      current();
      switch (intent.case) {
        case "rpc": {
          const call = intent.value;
          const request = coreRequests.buildRequest(toBinary(RpcCallSchema, call), snapshot.context);
          current();
          await capabilities.rpc!.invoke(call.service, call.method, request, signal);
          break;
        }
        case "uri": await capabilities.uri!(intent.value, snapshot.context, signal); break;
        case "command": await capabilities.command!(intent.value, snapshot.context, signal); break;
        case "navigate": await capabilities.navigate!(intent.value, snapshot.context, signal); break;
        case "openPanel": await capabilities.openPanel!(intent.value, snapshot.context, signal); break;
        case "openView": await capabilities.openView!(intent.value, snapshot.context, signal); break;
        case "copy": await capabilities.copy!(intent.value, snapshot.context, signal); break;
      }
      current();
      if (affordance.refreshOnSuccess !== true) {
        return { status: "succeeded", refresh: "not-requested" };
      }
      if (!snapshot.refresh) return { status: "succeeded", refresh: "failed" };
      try {
        await snapshot.refresh(signal);
        current();
        return { status: "succeeded", refresh: "succeeded" };
      } catch (error) {
        if (error instanceof Stopped) throw error;
        // The effect succeeded. Do not turn a refresh error into an invitation
        // to replay a successful mutation, command, or clipboard operation.
        current();
        return { status: "succeeded", refresh: "failed" };
      }
    } catch (error) {
      if (signal.aborted || disposed) return { status: "cancelled" };
      if (error instanceof Stopped) return { status: error.status };
      // A late rejection belongs to the old scope just like a late success.
      // Do not display its failure against a replacement row/view.
      try {
        if (snapshot && readCurrent() !== snapshot) return { status: "stale" };
      } catch { return { status: "failed" }; }
      if (error instanceof Denied) return { status: "denied", reason: error.reason };
      return { status: "failed" };
    } finally {
      active = undefined;
    }
  }

  return {
    activate,
    get pending() { return active !== undefined; },
    // Keep duplicate suppression until the underlying operation settles, even
    // when a legacy transport ignores abort. cancel() is not rollback.
    cancel() { active?.abort(); },
    dispose() { disposed = true; active?.abort(); },
  };
}
