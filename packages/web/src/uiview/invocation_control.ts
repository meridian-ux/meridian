import { clone } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { ActionSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { ConfirmSpecSchema, type ConfirmSpec } from "@savvifi/meridian-proto-ts/proto/resource_card_pb.js";
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

/** Own the existing JSON host seam before retaining prefill/input. */
export function ownInvocationData(value: unknown): unknown { return JSON.parse(inertJson(value)); }
export function assertInvocationDescriptorData(value: unknown): void { inertJson(value, true); }

export interface InvocationControlOptions {
  action: NormalizedAction;
  /** Original protobuf declaration. A change withdraws this mounted projection;
   * the host must remount to publish a replacement declaration. */
  declaration?: object;
  invoker: RpcInvoker;
  context: RenderContext;
  record?: object;
  /** Panel-local live row; null means no selection. Never a host grant. */
  readRecord?: () => object | null;
  recordKey?: () => unknown;
  blocked?: () => boolean;
  /** Renderer-owned refresh must check currentness before applying async data. */
  refresh?: (signal: AbortSignal, current: () => boolean) => Promise<void>;
  confirmation?: { spec: ConfirmSpec; present: (spec: ConfirmSpec, context: RenderContext, signal: AbortSignal) => Promise<boolean> };
  subject?: InvocationSnapshot["subject"];
  invocation?: InvocationHost;
  admission?: AdmissionPolicy;
  alive: () => boolean;
  onDispose: (dispose: () => void) => void;
  renderIcon?: (key: string) => HTMLElement | undefined;
  submission?: InvocationSnapshot["submission"];
  /** Validated event-only DOM collector; never called during construction/paint. */
  readFormValues?: () => Record<string, unknown>;
  onInvalid?: (reason: unknown) => void;
  onPending?: (pending: boolean) => void;
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
export function createInvocationControl(options: InvocationControlOptions) {
  const item = document.createElement("span"); item.className = "mer-affordance-item";
  const button = document.createElement("button"); button.type = "button";
  const description = document.createElement("span"); description.className = "mer-affordance-desc";
  const feedback = document.createElement("span"); feedback.className = "mer-action-feedback";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel action"; cancel.hidden = true;
  const id = `mer-invocation-${++nextId}`; feedback.id = `${id}-feedback`; description.id = `${id}-description`;
  let disposed = false, cache: { signature: unknown[]; snapshot: InvocationSnapshot } | undefined;
  let collecting = false, activating = false, declarationJson: string | undefined;
  const ownContextField = (context: object, key: string) => {
    const field = Object.getOwnPropertyDescriptor(context, key);
    if (field && !("value" in field)) throw Error("Invalid invocation context.");
    return field?.value;
  };
  const read = (): InvocationSnapshot | undefined => {
    if (disposed || !options.alive()) return undefined;
    try {
      const currentDeclaration = inertJson(options.declaration ?? null, true);
      if (declarationJson !== undefined && declarationJson !== currentDeclaration) return undefined;
      declarationJson = currentDeclaration;
      const { action, invocation: host, admission, invoker } = options;
      const context = host?.context ?? options.context;
      const record = options.readRecord ? options.readRecord() : options.record;
      const actionJson = inertJson(action.affordance, true), semanticJson = inertJson(action.semanticAction ?? null, true);
      let values: Record<string, unknown> | undefined;
      if (collecting && options.readFormValues) {
        try { values = options.readFormValues(); } catch (reason) { options.onInvalid?.(reason); throw reason; }
      }
      const contextJson = options.readFormValues ? inertJson({
        currentResourcePath: ownContextField(context, "currentResourcePath") ?? null,
        uiIdentity: ownContextField(context, "uiIdentity") ?? null,
        selectedRow: record ?? ownContextField(context, "selectedRow") ?? null,
        formValues: values ?? {}, signals: ownContextField(context, "signals"), selections: ownContextField(context, "selections"),
      }) : record === undefined ? inertJson(context)
        : inertJson({ currentResourcePath: ownContextField(context, "currentResourcePath") ?? null,
          uiIdentity: ownContextField(context, "uiIdentity") ?? null, selectedRow: record,
          formValues: ownContextField(context, "formValues"), signals: ownContextField(context, "signals"), selections: ownContextField(context, "selections") });
      const submissionJson = inertJson(options.submission ?? null, true);
      const confirmationJson = inertJson(options.confirmation?.spec ?? null, true);
      const policyJson = inertJson(admission === "unrestricted" ? admission : { reads: admission?.reads, mutations: admission?.mutations, inferFromAipVerbs: admission?.inferFromAipVerbs });
      const subjectJson = inertJson(options.subject ?? null);
      const caps = host?.capabilities, admit = host?.admit;
      const signature = [actionJson, semanticJson, contextJson, policyJson, subjectJson, submissionJson, action.legacyOrigin, options.readFormValues, options.recordKey?.(),
        invoker, invoker.invoke, caps?.uri, caps?.command, caps?.navigate, caps?.openPanel, caps?.openView, caps?.copy, caps?.rpc, caps?.rpc?.invoke,
        admit, host?.resolveSemantic, host?.refresh, options.refresh, confirmationJson, options.confirmation?.present, admission === "unrestricted" ? undefined : admission?.onDenied];
      if (cache && signature.every((value, index) => Object.is(value, cache!.signature[index]))) return cache.snapshot;
      // Clone protos only after inert bounds/accessor/cycle admission.
      const confirmation = options.confirmation;
      const confirmSpec = confirmation ? clone(ConfirmSpecSchema, confirmation.spec) : undefined;
      const snapshot: InvocationSnapshot = {
        action: new NormalizedAction(clone(AffordanceSchema, action.affordance), action.semanticAction ? clone(ActionSchema, action.semanticAction) : undefined, action.legacyOrigin),
        context: JSON.parse(contextJson), subject: JSON.parse(subjectJson) ?? undefined,
        admission: admission === "unrestricted" ? admission : { ...JSON.parse(policyJson), onDenied: admission?.onDenied },
        capabilities: { ...caps, rpc: caps?.rpc ?? { invoke: (service, method, request) => invoker.invoke(service, method, request) } },
        resolveSemantic: host?.resolveSemantic,
        refresh: options.refresh ? signal => options.refresh!(signal, () => !signal.aborted && read() === snapshot) : host?.refresh,
        confirm: confirmation && confirmSpec ? (context, signal) => confirmation.present(confirmSpec, context, signal) : undefined,
        submission: options.submission ? { kind: options.submission.kind, fields: options.submission.fields.map(field => clone(FormFieldSchema, field)) } : undefined,
        admit: (intent, context) => {
          if (intent.case === "uri" && !safeNavigationHref(intent.value) || intent.case === "navigate" && !safeNavigationHref(intent.value.route)) return false;
          return admit ? admit(intent, context) : intent.case === "rpc";
        },
      };
      cache = { signature, snapshot }; return snapshot;
    } catch { cache = undefined; return undefined; }
  };
  const dispatcher = createInvocationDispatcher(() => {
    const scope = read();
    return options.readRecord && !scope?.context.selectedRow ? undefined : scope;
  });
  const dispose = () => { disposed = true; cache = undefined; dispatcher.dispose(); };
  options.onDispose(dispose);
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
  try { denied ||= !options.readRecord && !!aff?.enabledWhen && !matchesRowFilter(aff.enabledWhen, initial!.context.selectedRow); } catch { denied = true; }
  const unsafe = aff?.invoke.case === "uri" && !safeNavigationHref(aff.invoke.value) || aff?.invoke.case === "navigate" && !safeNavigationHref(aff.invoke.value.route);
  const policyDenied = aff?.invoke.case === "rpc" && !createAdmissionGate(options.admission).admits("mutation", aff.invoke.value.service, aff.invoke.value.method);
  if (denied || unsafe) { button.disabled = true; button.setAttribute("aria-disabled", "true"); setMessage("Action unavailable: the descriptor, context, conditions, or destination is invalid.", true); }
  else if (policyDenied) { button.setAttribute("aria-disabled", "true"); setMessage("Unavailable: this action is not permitted."); }
  else if (description.textContent) button.setAttribute("aria-describedby", description.id);
  let paintedScope = initial;
  const sync = () => {
    const pending = activating || dispatcher.pending;
    const scope = read();
    if (scope !== paintedScope) {
      // Selection changes invalidate consent, but do not release the dispatcher's
      // duplicate guard while a noncooperative transport is still settling.
      if (pending) dispatcher.cancel();
      feedback.textContent = ""; feedback.removeAttribute("role"); paintedScope = scope;
    }
    let rowDenied = false;
    try { rowDenied = !!options.readRecord && (!scope?.context.selectedRow || !!scope.action.affordance.enabledWhen && !matchesRowFilter(scope.action.affordance.enabledWhen, scope.context.selectedRow)); }
    catch { rowDenied = true; }
    button.disabled = denied || !!unsafe || rowDenied || !!options.blocked?.() && !pending;
    if (pending || policyDenied || button.disabled) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
    if (!pending && !feedback.textContent) {
      if (!scope) setMessage("Action unavailable: the descriptor or context is invalid. Update the view before retrying.", true);
      else if (policyDenied) setMessage("Unavailable: this action is not permitted.");
      else button.setAttribute("aria-describedby", description.textContent ? description.id : "");
    }
  };
  cancel.onclick = () => { dispatcher.cancel(); setMessage("Cancellation requested; waiting for the action to stop."); };
  const activate = async (): Promise<InvocationOutcome | undefined> => {
    if (disposed || !options.alive() || activating || dispatcher.pending || button.disabled || options.blocked?.()) return;
    collecting = true;
    const scope = read();
    if (!scope) { setMessage("Action unavailable: the descriptor or context is invalid.", true); return; }
    button.setAttribute("aria-busy", "true"); button.setAttribute("aria-disabled", "true"); cancel.hidden = false; setMessage("Action is running.");
    activating = true;
    options.onPending?.(true);
    const outcome = await dispatcher.activate();
    activating = false;
      if (disposed || !options.alive()) return;
      const current = read() === scope;
      if (current && document.activeElement === cancel && button.isConnected) button.focus();
      button.removeAttribute("aria-busy"); if (!policyDenied) button.removeAttribute("aria-disabled"); cancel.hidden = true;
      if (current) setMessage(outcomeText(outcome), outcome.status === "failed" || outcome.status === "denied");
      else { feedback.textContent = ""; feedback.removeAttribute("role"); }
      options.onPending?.(false);
      if (options.readRecord || options.blocked) sync();
      return current ? outcome : undefined;
  };
  button.onclick = () => { void activate(); };
  item.append(button); if (description.textContent) item.append(description); item.append(feedback, cancel);
  if (options.readRecord || options.blocked) sync();
  return { element: item, button, activate, dispose, sync };
}
export function buildInvocationControl(options: InvocationControlOptions): HTMLElement { return createInvocationControl(options).element; }
let nextId = 0;
