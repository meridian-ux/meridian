// Fetch state stays in this process. Authored data uses the canonical StatPanel
// and RpcCall messages, and transport uses the existing host invoker seam.
import { useContext, useEffect, useMemo, useState } from "react";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import { MeridianRecordContext, useMeridianSelection } from "./pagination.js";
import { actionRequestJson, boundedJson } from "./action_request.js";
import { useMeridian } from "./provider.js";

export function useStatData(panel: StatPanel): { record?: object; loading: boolean; error: boolean } {
  const { invoker } = useMeridian();
  const selection = useMeridianSelection();
  const record = useContext(MeridianRecordContext);
  const request = actionRequestJson(panel.populate, selection.values, record);
  let descriptor: string | undefined;
  try { descriptor = boundedJson(panel); } catch { /* Invalid identity fails closed below. */ }
  const key = JSON.stringify([descriptor, request]);
  const service = panel.populate?.service;
  const method = panel.populate?.method;
  const enabled = Boolean(panel.populate);
  const rejected = request === undefined || descriptor === undefined;
  const identity = useMemo(() => ({ key, invoker, enabled, rejected }), [key, invoker, enabled, rejected]);
  const [result, setResult] = useState<{ identity: typeof identity; record?: object; error: boolean }>();
  useEffect(() => {
    if (!enabled || rejected || request === undefined || !service || !method) return;
    let active = true;
    void Promise.resolve().then(() => active ? invoker.invoke(service, method, JSON.parse(request)) : undefined)
      .then(record => {
        if (!active) return;
        if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Invalid metric response.");
        setResult({ identity, record, error: false });
      })
      .catch(() => { if (active) setResult({ identity, error: true }); });
    return () => { active = false; };
  }, [identity, request, service, method, invoker, enabled, rejected]);
  if (!enabled) return { loading: false, error: false };
  if (rejected) return { loading: false, error: true };
  // Never expose a previous descriptor, request, or transport's result, even
  // during the render before cancellation cleanup and the next effect run.
  return result?.identity === identity
    ? { record: result.record, loading: false, error: result.error }
    : { loading: true, error: false };
}
