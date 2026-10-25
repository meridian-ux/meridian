import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { AffordanceCollectionSchema } from "@savvifi/meridian-proto-ts/proto/interaction_pb.js";
import { AdmissionDeniedError, formatLroMetadata } from "@savvifi/meridian-schemas/uiview";
import { boundedJson, boundedResponse, buildLroFinalizeRequest, buildSubmissionRequest } from "./action_request.js";
import { MeridianRecordContext, selectionDeps, useMeridianSelection } from "./pagination.js";
import { useMeridian } from "./provider.js";
import { MeridianRowActionsContext, MeridianNormalizedRowActionsContext } from "./view_renderer.js";

type Row = Record<string, unknown>;
const CANCELLED = Symbol("cancelled operation observation");
const MAX_DURATION = 30 * 60 * 1000;
// Also bound immediately resolved/no-wait hosts instead of spinning until the
// wall-clock deadline. With the requested five-second waits this is 30 minutes.
const MAX_POLLS = 360;
const NO_ROW_ACTIONS: never[] = [];

function operation(value: unknown, expectedName?: string): Row {
  const op = boundedResponse(value);
  if (op.done !== undefined && typeof op.done !== "boolean") throw new Error("Invalid operation completion flag.");
  if ((!op.done || op.name !== undefined) && (typeof op.name !== "string" || !op.name || op.name.length > 16_384))
    throw new Error("Invalid operation name.");
  if (expectedName && op.name !== expectedName) throw new Error("Operation identity changed while polling.");
  if (op.error !== undefined && (!op.error || typeof op.error !== "object" || Array.isArray(op.error)))
    throw new Error("Invalid operation error.");
  if (op.metadata !== undefined && (!op.metadata || typeof op.metadata !== "object" || Array.isArray(op.metadata)))
    throw new Error("Invalid operation metadata.");
  if (op.response !== undefined && (!op.response || typeof op.response !== "object" || Array.isArray(op.response)))
    throw new Error("Invalid operation response.");
  if (op.error && op.response) throw new Error("Operation has both an error and a response.");
  return op;
}

function unpack(value: unknown, expectedType: string): Row {
  const fields = value === undefined ? {} : value as Row;
  const type = fields["@type"];
  if (type !== undefined && (typeof type !== "string" || (expectedType && type.split("/").at(-1) !== expectedType)))
    throw new Error("Operation payload type does not match the descriptor.");
  // Expanded proto3 JSON Any is the existing transport contract. No binary Any
  // decoder or independent schema is introduced by this runtime projection.
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "@type"));
}

/** Shared event-driven operation lifecycle. All RPCs use the provider's guarded
 * host transports. Cleanup stops observation, never cancels a server operation. */
export function useLroLifecycle(panel: LroPanel) {
  const { invoker, mutationInvoker } = useMeridian();
  const selection = useMeridianSelection();
  const record = useContext(MeridianRecordContext);
  let descriptor: string | undefined;
  try { descriptor = boundedJson(panel); } catch { /* fail before transport */ }
  const selectionKey = JSON.stringify([selectionDeps(panel.start, selection.values), selectionDeps(panel.finalize, selection.values)]);
  const scope = useMemo(() => ({}), [descriptor, selectionKey, record, invoker, mutationInvoker]);
  const committed = useRef<object | undefined>(undefined);
  const active = useRef<{ scope: object; cancel: () => void } | undefined>(undefined);
  const [state, setState] = useState<{ scope: object; pending: boolean; message: string; error?: string; denied?: boolean; source?: Row }>();
  useLayoutEffect(() => {
    committed.current = scope;
    return () => {
      committed.current = undefined;
      active.current?.cancel();
      active.current = undefined;
    };
  }, [scope]);
  const run = useCallback(async (values: Row) => {
    if (active.current || committed.current !== scope) return;
    let cancel!: () => void;
    const cancellation = new Promise<typeof CANCELLED>(resolve => { cancel = () => resolve(CANCELLED); });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out before completion.")), MAX_DURATION); });
    const attempt = { scope, cancel };
    active.current = attempt;
    const live = () => committed.current === scope && active.current === attempt;
    const update = (message: string, source?: Row) => {
      if (live()) setState({ scope, pending: true, message, source });
    };
    async function observe(request: () => Promise<object>): Promise<object> {
      if (!live()) throw CANCELLED;
      const value = await Promise.race([request(), cancellation, timeout]);
      if (!live() || value === CANCELLED) throw CANCELLED;
      return value;
    }
    try {
      if (descriptor === undefined) throw new Error("Operation descriptor rejected.");
      const start = panel.start;
      if (!start) throw new Error("Missing start call.");
      // Own the submitted values for later finalize bindings; a host cannot
      // mutate an in-flight form and thereby rewrite the follow-up request.
      const submitted = boundedResponse(values);
      const selected = boundedResponse(selection.values) as Record<string, string>;
      if (Object.values(selected).some(value => typeof value !== "string")) throw new Error("Invalid operation selection.");
      const request = buildSubmissionRequest(start, panel.inputs, submitted, selected, "lro", record);
      update("Starting…");
      let op = operation(await observe(() => mutationInvoker.invoke(start.service, start.method, request)));
      const name = op.name as string;
      const deadline = Date.now() + MAX_DURATION;
      let polls = 0;
      while (!op.done) {
        if (Date.now() >= deadline || polls++ >= MAX_POLLS) throw new Error("Timed out before completion.");
        update(op.metadata ? formatLroMetadata(unpack(op.metadata, panel.metadataType)) : `Running ${name}…`);
        op = operation(await observe(() => invoker.invoke("google.longrunning.Operations", "WaitOperation", {
          name, timeout: { seconds: 5 },
        })), name);
      }
      if (op.error) {
        const message = (op.error as Row).message;
        throw new Error(typeof message === "string" && message ? message : "Operation failed.");
      }
      let source = unpack(op.response, panel.responseType);
      if (panel.finalize) {
        const call = panel.finalize;
        const request = buildLroFinalizeRequest(call, panel.inputs, submitted, selected, source);
        update(`Running ${call.method}…`);
        source = boundedResponse(await observe(() => mutationInvoker.invoke(call.service, call.method, request)));
      }
      if (live()) setState({ scope, pending: false, message: "Done.", source });
    } catch (reason) {
      if (live() && reason !== CANCELLED) setState({ scope, pending: false, message: "", error: reason instanceof Error ? reason.message : String(reason), denied: reason instanceof AdmissionDeniedError });
    } finally {
      clearTimeout(timer!);
      if (active.current === attempt) active.current = undefined;
    }
  }, [scope, descriptor, panel, invoker, mutationInvoker, record, selection.values]);
  const current = state?.scope === scope ? state : undefined;
  return { run, pending: current?.pending ?? false, message: current?.message, error: current?.error, denied: current?.denied, source: current?.source };
}

/** Result tables use the active kit and an owned completed response, never their
 * authored populate/actions. Final results do not trigger another read or RPC. */
export function LroResult({ panel, source }: { panel: LroPanel; source: Row | undefined }): ReactNode {
  const { kit, invoker } = useMeridian();
  const table = useMemo(() => panel.result ? create(TablePanelSchema, { ...panel.result, populate: undefined,
    affordances: create(AffordanceCollectionSchema), pagination: undefined }) : undefined, [panel.result]);
  if (!table || !source) return null;
  const descriptor = create(PanelDescriptorSchema, { body: { case: "table", value: table } });
  return <MeridianNormalizedRowActionsContext.Provider value={NO_ROW_ACTIONS}><MeridianRowActionsContext.Provider value={NO_ROW_ACTIONS}><MeridianRecordContext.Provider value={source}>
    <kit.Table panel={table} descriptor={descriptor} invoker={invoker} />
  </MeridianRecordContext.Provider></MeridianRowActionsContext.Provider></MeridianNormalizedRowActionsContext.Provider>;
}
