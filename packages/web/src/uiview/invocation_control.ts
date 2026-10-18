import { clone } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { ActionSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { affordancePresentation, createAdmissionGate, createInvocationDispatcher, matchesRowFilter, NormalizedAction, safeNavigationHref,
  type AdmissionPolicy, type InvocationHost, type InvocationOutcome, type InvocationSnapshot, type RenderContext, type RpcInvoker,
} from "@savvifi/meridian-schemas/uiview";

// Runtime-only bounded snapshot ownership, not an alternate request builder.
// Actual request/binding admission remains in the shared Rust dispatcher.
function inertJson(value: unknown, descriptor = false): string {
  let work = 4 * 1024 * 1024, nodes = 65_536;
  const reserve = (cost: number) => { if (!Number.isSafeInteger(cost) || cost < 0 || (work -= cost) < 0) throw Error("Invalid invocation data."); };
  const ancestors = new Set<object>();
  const own = (value: object, key: string) => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !("value" in field)) throw Error("Invalid invocation data.");
    return field.value;
  };
  const copy = (value: unknown, depth: number): unknown => {
    // Proto oneof/message wrappers are not semantic request nesting. Match the
    // existing browser descriptor allowance without relaxing runtime data depth.
    if (--nodes < 0 || depth > (descriptor ? 512 : 64)) throw Error("Invalid invocation data."); reserve(64);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { reserve(6 * value.length + 2); return value; }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || ancestors.has(value)) throw Error("Invalid invocation data.");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error("Invalid invocation data.");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        reserve(value.length * 64);
        return Array.from({ length: value.length }, (_, index) => copy(own(value, String(index)), depth + 1));
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        reserve(6 * key.length + 2); const child = own(value, key);
        if (child !== undefined) Object.defineProperty(result, key, { value: copy(child, depth + 1), enumerable: true });
      }
      return result;
    } finally { ancestors.delete(value); }
  };
  return JSON.stringify(copy(value, 0));
}

export interface InvocationControlOptions {
  action: NormalizedAction;
  invoker: RpcInvoker;
  context: RenderContext;
  record?: object;
  subject?: InvocationSnapshot["subject"];
  invocation?: InvocationHost;
  admission?: AdmissionPolicy;
  alive: () => boolean;
  onDispose: (dispose: () => void) => void;
  renderIcon?: (key: string) => HTMLElement | undefined;
}

function outcomeText(outcome: InvocationOutcome): string {
  if (outcome.status === "succeeded") return outcome.refresh === "failed"
    ? "Action completed, but refresh is unavailable. Refresh the view without repeating the action." : "Action completed.";
  if (outcome.status === "failed") return "Action failed. Try again with the current context.";
  if (outcome.status === "cancelled") return "Action canceled.";
  if (outcome.status === "stale") return "Action stopped because its context changed.";
  if (outcome.status === "busy") return "Action is already running.";
  if (outcome.status !== "denied") return "Action unavailable.";
  return outcome.reason === "missing-target" || outcome.reason === "unsupported-target" || outcome.reason === "missing-resolver" || outcome.reason === "unresolved-action"
    ? "Action unavailable: this target is missing, unsupported, or unresolved."
    : "Action denied: the host policy, capability, or current record does not allow this action.";
}

/** A native button for all seven targets: no href, copy, or legacy fallback. */
export function buildInvocationControl(options: InvocationControlOptions): HTMLElement {
  const item = document.createElement("span"); item.className = "mer-affordance-item";
  const button = document.createElement("button"); button.type = "button";
  const description = document.createElement("span"); description.className = "mer-affordance-desc";
  const feedback = document.createElement("span"); feedback.className = "mer-action-feedback";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel action"; cancel.hidden = true;
  const id = `mer-invocation-${++nextId}`; feedback.id = `${id}-feedback`; description.id = `${id}-description`;
  let disposed = false, cache: { signature: unknown[]; snapshot: InvocationSnapshot } | undefined;
  const read = (): InvocationSnapshot | undefined => {
    if (disposed || !options.alive()) return undefined;
    try {
      const { action, invocation: host, admission, invoker } = options;
      const context = host?.context ?? options.context;
      const actionJson = inertJson(action.affordance, true), semanticJson = inertJson(action.semanticAction ?? null, true);
      const contextJson = options.record === undefined ? inertJson(context)
        : inertJson({ ...JSON.parse(inertJson(context)), selectedRow: options.record });
      const policyJson = inertJson(admission === "unrestricted" ? admission : { reads: admission?.reads, mutations: admission?.mutations, inferFromAipVerbs: admission?.inferFromAipVerbs });
      const subjectJson = inertJson(options.subject ?? null);
      const caps = host?.capabilities, admit = host?.admit;
      const signature = [actionJson, semanticJson, contextJson, policyJson, subjectJson, action.legacyOrigin,
        invoker, invoker.invoke, caps?.uri, caps?.command, caps?.navigate, caps?.openPanel, caps?.openView, caps?.copy, caps?.rpc, caps?.rpc?.invoke,
        admit, host?.resolveSemantic, host?.refresh, admission === "unrestricted" ? undefined : admission?.onDenied];
      if (cache && signature.every((value, index) => Object.is(value, cache!.signature[index]))) return cache.snapshot;
      // Clone protos only after inert bounds/accessor/cycle admission.
      const snapshot: InvocationSnapshot = {
        action: new NormalizedAction(clone(AffordanceSchema, action.affordance), action.semanticAction ? clone(ActionSchema, action.semanticAction) : undefined, action.legacyOrigin),
        context: JSON.parse(contextJson), subject: JSON.parse(subjectJson) ?? undefined,
        admission: admission === "unrestricted" ? admission : { ...JSON.parse(policyJson), onDenied: admission?.onDenied },
        capabilities: { ...caps, rpc: caps?.rpc ?? { invoke: (service, method, request) => invoker.invoke(service, method, request) } },
        resolveSemantic: host?.resolveSemantic, refresh: host?.refresh,
        admit: (intent, context) => {
          if (intent.case === "uri" && !safeNavigationHref(intent.value) || intent.case === "navigate" && !safeNavigationHref(intent.value.route)) return false;
          return admit ? admit(intent, context) : intent.case === "rpc";
        },
      };
      cache = { signature, snapshot }; return snapshot;
    } catch { cache = undefined; return undefined; }
  };
  const dispatcher = createInvocationDispatcher(read);
  options.onDispose(() => { disposed = true; cache = undefined; dispatcher.dispose(); });
  const initial = read(), aff = initial?.action.affordance;
  const presentation = aff ? affordancePresentation(aff) : undefined;
  button.className = `mer-affordance${presentation?.primary ? " mer-affordance-primary" : ""}`;
  button.textContent = aff?.label || "Action";
  if (aff?.icon) { button.dataset.icon = aff.icon; const glyph = options.renderIcon?.(aff.icon); if (glyph) { glyph.classList.add("mer-icon"); button.prepend(glyph); } }
  if (presentation?.tone !== undefined) button.dataset.merTone = presentation.tone;
  if (aff?.emphasis !== undefined) button.dataset.merEmphasis = presentation?.primary ? "primary" : "secondary";
  Object.assign(button.style, presentation?.style);
  description.textContent = aff?.description ?? "";
  if (description.textContent) button.title = description.textContent;
  const setMessage = (message: string, alert = false) => {
    feedback.textContent = message; feedback.setAttribute("role", alert ? "alert" : "status");
    button.setAttribute("aria-describedby", [description.textContent && description.id, message && feedback.id].filter(Boolean).join(" "));
  };
  let denied = !initial;
  try { denied ||= !!aff?.enabledWhen && !matchesRowFilter(aff.enabledWhen, initial!.context.selectedRow); } catch { denied = true; }
  const unsafe = aff?.invoke.case === "uri" && !safeNavigationHref(aff.invoke.value) || aff?.invoke.case === "navigate" && !safeNavigationHref(aff.invoke.value.route);
  const policyDenied = aff?.invoke.case === "rpc" && !createAdmissionGate(options.admission).admits("mutation", aff.invoke.value.service, aff.invoke.value.method);
  if (denied || unsafe) { button.disabled = true; button.setAttribute("aria-disabled", "true"); setMessage("Action unavailable: the descriptor, context, conditions, or destination is invalid.", true); }
  else if (policyDenied) { button.setAttribute("aria-disabled", "true"); setMessage("Unavailable: this action is not permitted."); }
  else if (description.textContent) button.setAttribute("aria-describedby", description.id);
  cancel.onclick = () => { dispatcher.cancel(); setMessage("Cancellation requested; waiting for the action to stop."); };
  button.onclick = () => {
    if (dispatcher.pending || button.disabled) return;
    const scope = read();
    if (!scope) { setMessage("Action unavailable: the descriptor or context is invalid.", true); return; }
    button.setAttribute("aria-busy", "true"); button.setAttribute("aria-disabled", "true"); cancel.hidden = false; setMessage("Action is running.");
    void dispatcher.activate().then(outcome => {
      if (disposed || !options.alive()) return;
      const current = read() === scope;
      if (current && document.activeElement === cancel && button.isConnected) button.focus();
      button.removeAttribute("aria-busy"); if (!policyDenied) button.removeAttribute("aria-disabled"); cancel.hidden = true;
      if (current) setMessage(outcomeText(outcome), outcome.status === "failed" || outcome.status === "denied");
      else { feedback.textContent = ""; feedback.removeAttribute("role"); }
    });
  };
  item.append(button); if (description.textContent) item.append(description); item.append(feedback, cancel);
  return item;
}
let nextId = 0;
