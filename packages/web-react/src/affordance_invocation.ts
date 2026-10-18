import { clone } from "@bufbuild/protobuf";
import { AffordanceSchema, type Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { ActionSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createAdmissionGate, createInvocationDispatcher, matchesRowFilter, NormalizedAction, normalizeAffordance,
  type InvocationOutcome, type InvocationSnapshot, type InvocationHost, type AdmissionPolicy, type RpcInvoker, type RenderContext,
} from "@savvifi/meridian-schemas/uiview";
import { boundedJson } from "./action_request.js";
import { EMPTY_SELECTION, MeridianRecordContext, useMeridianSelection, type MeridianSelection } from "./pagination.js";
import { useMeridian } from "./provider.js";

function feedback(outcome: InvocationOutcome | undefined): string | undefined {
  if (!outcome) return undefined;
  switch (outcome.status) {
    case "denied":
      switch (outcome.reason) {
        case "missing-target": case "unsupported-target": return "Action unavailable: this target is missing or unsupported.";
        case "missing-capability": return "Action denied: this host has not enabled the required capability.";
        case "mutation-policy": return "Action denied: the host mutation policy does not allow this RPC.";
        case "target-policy": return "Action denied: the host target policy does not allow this action.";
        case "disabled": return "Action denied: the current record does not meet its conditions.";
        case "missing-resolver": case "unresolved-action": return "Action unavailable: the host could not resolve this action.";
      }
    case "failed": return "Action failed. Try again with the current context.";
    case "cancelled": return "Action canceled.";
    case "stale": return "Action stopped because its context changed.";
    case "busy": return "Action is already running.";
    case "succeeded": return outcome.refresh === "failed"
      ? "Action completed, but refresh is unavailable. Refresh the view without repeating the action."
      : "Action completed.";
  }
}

/** Runtime-only adapter inputs, never serialized grants or alternate DTOs. */
export interface ActionInvocationOptions {
  row?: object;
  subject?: InvocationSnapshot["subject"];
  refresh?: InvocationSnapshot["refresh"];
  enabled?: boolean;
  legacyRowIdFallback?: boolean;
}

// A reader owns its copies but follows the committed source handles. The old
// selection bag is intentionally live, including changes without a React render.
// Building a frame invokes no resolver, policy callback, transport, or effect.
function frameFor(action: NormalizedAction, options: ActionInvocationOptions, host: InvocationHost | undefined,
  admission: AdmissionPolicy | undefined, invoker: RpcInvoker, record: object | undefined, selection: MeridianSelection) {
  const affordance = action.affordance;
  const context = host?.context;
  let descriptorKey: string | undefined, semanticKey: string | undefined, contextKey: string | undefined;
  let subjectKey: string | undefined, policyKey: string | undefined;
  try {
    if (options.enabled === false) {
      // Retain the logical control/duplicate guard while closed, without
      // materializing its future descriptor or repeated runtime context.
      descriptorKey = semanticKey = subjectKey = contextKey = "";
    } else {
      descriptorKey = boundedJson(affordance);
      semanticKey = boundedJson(action.semanticAction ?? null);
      subjectKey = boundedJson(options.subject ?? null);
      contextKey = boundedJson({ currentResourcePath: context?.currentResourcePath ?? null, uiIdentity: context?.uiIdentity ?? null,
        selectedRow: Object.hasOwn(options, "row") ? options.row ?? null : record ?? context?.selectedRow ?? null,
        formValues: context?.formValues ?? {}, signals: context?.signals,
        selections: selection === EMPTY_SELECTION ? context?.selections : selection.values,
      });
    }
    policyKey = admission === "unrestricted" ? "unrestricted" : boundedJson({
      reads: admission?.reads, mutations: admission?.mutations, inferFromAipVerbs: admission?.inferFromAipVerbs,
    });
  } catch { /* Fail visibly without evaluating data accessors. */ }
  const denied = admission === "unrestricted" ? undefined : admission?.onDenied;
  const { uri, command, navigate, openPanel, openView, copy, rpc } = host?.capabilities ?? {};
  const admit = host?.admit, resolveSemantic = host?.resolveSemantic, refresh = options.refresh ?? host?.refresh;
  const invoke = invoker.invoke, rpcInvoke = rpc?.invoke;
  const signature = [descriptorKey, semanticKey, contextKey, subjectKey, policyKey, denied,
    action.legacyOrigin, action.legacyOrigin ? affordance.invoke.value : affordance, action.semanticAction, affordance.enabledWhen,
    options.enabled, options.legacyRowIdFallback, options.row, record, selection, invoker, invoke,
    uri, command, navigate, openPanel, openView, copy, rpc, rpcInvoke, admit, resolveSemantic, refresh];
  const build = (): InvocationSnapshot | undefined => {
    if (options.enabled === false || descriptorKey === undefined || semanticKey === undefined || contextKey === undefined
      || subjectKey === undefined || policyKey === undefined) return undefined;
    try {
      return {
        action: new NormalizedAction(clone(AffordanceSchema, affordance),
          action.semanticAction ? clone(ActionSchema, action.semanticAction) : undefined, action.legacyOrigin),
        context: JSON.parse(contextKey) as RenderContext,
        subject: JSON.parse(subjectKey) ?? undefined,
        admission: policyKey === "unrestricted" ? "unrestricted" : { ...JSON.parse(policyKey), onDenied: denied },
        capabilities: { uri, command, navigate, openPanel, openView, copy,
          rpc: { invoke: (service, method, request, signal) => rpc && rpcInvoke
            ? rpcInvoke.call(rpc, service, method, request, signal) : invoke.call(invoker, service, method, request) } },
        admit, resolveSemantic, refresh, legacyRowIdFallback: options.legacyRowIdFallback,
      };
    } catch { return undefined; }
  };
  return { signature, build, policyKey };
}

export function useAffordanceInvocation(affordance: Affordance) {
  return useActionInvocation(normalizeAffordance(affordance));
}

/** One shared host dispatcher for canonical and normalized legacy sources. */
export function useActionInvocation(action: NormalizedAction, options: ActionInvocationOptions = {}) {
  const { invocation, admission, actionInvoker } = useMeridian();
  const record = useContext(MeridianRecordContext);
  const selection = useMeridianSelection();
  const cache = useRef<{ signature: unknown[]; snapshot: InvocationSnapshot | undefined }>(undefined);
  const frame = frameFor(action, options, invocation, admission, actionInvoker, record, selection);
  const renderedSnapshot = useMemo(frame.build, frame.signature);
  const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const snapshot = cache.current && same(cache.current.signature, frame.signature) ? cache.current.snapshot : renderedSnapshot;
  const reader = useRef<(() => InvocationSnapshot | undefined) | undefined>(undefined);
  const readCurrent = () => reader.current?.();
  const [dispatcher] = useState(() => createInvocationDispatcher(readCurrent));
  useLayoutEffect(() => {
    if (cache.current && !same(cache.current.signature, frame.signature)) dispatcher.cancel();
    cache.current = { snapshot, signature: frame.signature };
    reader.current = () => {
      const fresh = frameFor(action, options, invocation, admission, actionInvoker, record, selection);
      if (!cache.current || !same(fresh.signature, cache.current.signature)) {
        cache.current = { signature: fresh.signature, snapshot: fresh.build() };
      }
      return cache.current.snapshot;
    };
  }, [snapshot, dispatcher, action, options, invocation, admission, actionInvoker, record, selection]);
  const [execution, setExecution] = useState<{
    token: object; snapshot: InvocationSnapshot; pending: boolean; cancelled?: boolean; outcome?: InvocationOutcome;
  }>();
  const feedbackId = useId();
  const mounted = useRef(false);
  const focusReturn = useRef<{ scope: InvocationSnapshot; trigger?: HTMLElement; cancel?: HTMLElement }>(undefined);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; reader.current = undefined; cache.current = undefined; dispatcher.cancel(); };
  }, [dispatcher]);

  async function activate(trigger?: HTMLElement) {
    const scope = readCurrent();
    if (!scope || dispatcher.pending) return;
    const token = {};
    focusReturn.current = { scope, trigger };
    setExecution({ token, snapshot: scope, pending: true });
    const outcome = await dispatcher.activate();
    if (!mounted.current) return;
    const focus = focusReturn.current;
    if (readCurrent() === scope && focus?.scope === scope && focus.trigger?.isConnected
      && focus.cancel && focus.cancel.ownerDocument.activeElement === focus.cancel) focus.trigger.focus();
    setExecution(previous => previous?.token === token ? { token, snapshot: scope, pending: false, outcome } : previous);
    return readCurrent() === scope ? outcome : undefined;
  }
  const pending = execution?.pending === true;
  const intent = action.affordance.invoke;
  const previewPolicy: AdmissionPolicy | undefined = frame.policyKey === "unrestricted" ? "unrestricted"
    : frame.policyKey === undefined ? undefined : JSON.parse(frame.policyKey) as AdmissionPolicy;
  const policyDenied = intent.case === "rpc" && !createAdmissionGate(previewPolicy).admits("mutation", intent.value.service, intent.value.method);
  let predicateDenied = false;
  try { predicateDenied = !!snapshot?.action.affordance.enabledWhen && !matchesRowFilter(snapshot.action.affordance.enabledWhen, snapshot.context.selectedRow); }
  catch { predicateDenied = true; }
  const outcome = execution?.snapshot === snapshot ? execution?.outcome : undefined;
  const message = options.enabled === false ? undefined : !snapshot ? "Action unavailable: the descriptor or context is invalid or exceeds supported limits."
    : pending ? execution?.cancelled ? "Cancellation requested; waiting for the action to stop." : "Action is running." : feedback(outcome);
  return { activate, pending, feedback: message, feedbackId, unavailable: !snapshot, policyDenied, predicateDenied, outcome,
    cancel(button?: HTMLElement) {
      if (focusReturn.current) focusReturn.current.cancel = button;
      dispatcher.cancel();
      setExecution(previous => previous?.pending ? { ...previous, cancelled: true } : previous);
    },
  };
}
