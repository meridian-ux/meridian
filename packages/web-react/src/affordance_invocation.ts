import { clone } from "@bufbuild/protobuf";
import { AffordanceSchema, type Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { useContext, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createInvocationDispatcher, normalizeAffordance, type InvocationOutcome,
  type InvocationSnapshot, type AdmissionPolicy, type RenderContext } from "@savvifi/meridian-schemas/uiview";
import { boundedJson } from "./action_request.js";
import { EMPTY_SELECTION, MeridianRecordContext, useMeridianSelection } from "./pagination.js";
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

/** Shared by all React kits. Own bounded inert descriptor/context copies so
 * in-place edits followed by a render replace the scope too. Commit the scope
 * in a layout effect: speculative renders never retarget an existing handler.
 * Capability/policy callbacks are captured independently of mutable host bags.
 */
export function useAffordanceInvocation(affordance: Affordance) {
  const { invocation, admission, actionInvoker } = useMeridian();
  const record = useContext(MeridianRecordContext);
  const selection = useMeridianSelection();
  const hostContext = invocation?.context;
  let descriptorKey: string | undefined, contextKey: string | undefined, policyKey: string | undefined;
  try {
    descriptorKey = boundedJson(affordance);
    contextKey = boundedJson({
      currentResourcePath: hostContext?.currentResourcePath ?? null,
      uiIdentity: hostContext?.uiIdentity ?? null,
      selectedRow: record ?? hostContext?.selectedRow ?? null,
      formValues: hostContext?.formValues ?? {},
      signals: hostContext?.signals,
      selections: selection === EMPTY_SELECTION ? hostContext?.selections : selection.values,
    });
    policyKey = admission === "unrestricted" ? "unrestricted" : boundedJson({
      reads: admission?.reads, mutations: admission?.mutations, inferFromAipVerbs: admission?.inferFromAipVerbs,
    });
  } catch { /* Invalid descriptors/context fail visibly without invoking getters or effects. */ }
  const denied = admission === "unrestricted" ? undefined : admission?.onDenied;
  const { uri, command, navigate, openPanel, openView, copy } = invocation?.capabilities ?? {};
  const admit = invocation?.admit, resolveSemantic = invocation?.resolveSemantic, refresh = invocation?.refresh;
  const invoke: (service: string, method: string, request: object, signal?: AbortSignal) => Promise<object> = actionInvoker.invoke;
  const snapshot = useMemo<InvocationSnapshot | undefined>(() => {
    if (descriptorKey === undefined || contextKey === undefined || policyKey === undefined) return undefined;
    let ownedAction: Affordance;
    try { ownedAction = clone(AffordanceSchema, affordance); } catch { return undefined; }
    const policy: AdmissionPolicy = policyKey === "unrestricted" ? "unrestricted" : { ...JSON.parse(policyKey), onDenied: denied };
    return {
      action: normalizeAffordance(ownedAction),
      context: JSON.parse(contextKey) as RenderContext,
      admission: policy,
      capabilities: { uri, command, navigate, openPanel, openView, copy,
        rpc: { invoke: (service, method, request, signal) => invoke.call(actionInvoker, service, method, request, signal) } },
      admit, resolveSemantic, refresh,
    };
  }, [descriptorKey, contextKey, policyKey, denied, affordance, actionInvoker, invoke,
    uri, command, navigate, openPanel, openView, copy, admit, resolveSemantic, refresh]);
  const current = useRef<InvocationSnapshot | undefined>(undefined);
  const [dispatcher] = useState(() => createInvocationDispatcher(() => current.current));
  useLayoutEffect(() => {
    current.current = snapshot;
    return () => {
      current.current = undefined;
      dispatcher.cancel();
    };
  }, [snapshot, dispatcher]);
  const [execution, setExecution] = useState<{
    token: object; snapshot: InvocationSnapshot; pending: boolean; cancelled?: boolean; outcome?: InvocationOutcome;
  }>();
  const feedbackId = useId();
  const mounted = useRef(false);
  const focusReturn = useRef<{ scope: InvocationSnapshot; trigger?: HTMLElement; cancel?: HTMLElement }>(undefined);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function activate(trigger?: HTMLElement) {
    const scope = current.current;
    if (!scope || dispatcher.pending) return;
    const token = {};
    focusReturn.current = { scope, trigger };
    setExecution({ token, snapshot: scope, pending: true });
    const outcome = await dispatcher.activate();
    if (!mounted.current) return;
    const focus = focusReturn.current;
    if (current.current === scope && focus?.scope === scope && focus.trigger?.isConnected
      && focus.cancel && focus.cancel.ownerDocument.activeElement === focus.cancel) focus.trigger.focus();
    setExecution(previous => previous?.token === token ? { token, snapshot: scope, pending: false, outcome } : previous);
  }
  const pending = execution?.pending === true;
  const message = !snapshot ? "Action unavailable: the descriptor or context is invalid or exceeds supported limits."
    : pending ? execution?.cancelled ? "Cancellation requested; waiting for the action to stop." : "Action is running."
    : execution?.snapshot === snapshot ? feedback(execution.outcome) : undefined;
  return {
    activate, pending, feedback: message, feedbackId, unavailable: !snapshot,
    cancel(button?: HTMLElement) {
      if (focusReturn.current) focusReturn.current.cancel = button;
      dispatcher.cancel();
      setExecution(previous => previous?.pending ? { ...previous, cancelled: true } : previous);
    },
  };
}
