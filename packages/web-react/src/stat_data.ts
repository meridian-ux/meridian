// Fetch state stays in this process. Authored data uses the canonical StatPanel
// and RpcCall messages, and transport uses the existing host invoker seam.
import { useContext, useEffect, useState } from "react";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { buildActionBindingRequest, MeridianRecordContext, useMeridianSelection } from "./pagination.js";
import { useMeridian } from "./provider.js";

export function useStatData(panel: StatPanel): { record?: object; loading: boolean; error: boolean } {
  const { invoker } = useMeridian();
  const selection = useMeridianSelection();
  const record = useContext(MeridianRecordContext);
  const request = JSON.stringify(buildActionBindingRequest(panel.populate, selection.values, record));
  const key = JSON.stringify([panel, request]);
  const service = panel.populate?.service;
  const method = panel.populate?.method;
  const enabled = Boolean(service && method);
  const [result, setResult] = useState<{ key: string; invoker: RpcInvoker; record?: object; error: boolean }>();
  useEffect(() => {
    if (!enabled || !service || !method) return;
    let active = true;
    void Promise.resolve().then(() => active ? invoker.invoke(service, method, JSON.parse(request)) : undefined)
      .then(record => {
        if (!active) return;
        if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Invalid metric response.");
        setResult({ key, invoker, record, error: false });
      })
      .catch(() => { if (active) setResult({ key, invoker, error: true }); });
    return () => { active = false; };
  }, [key, request, service, method, invoker, enabled]);
  if (!enabled) return { loading: false, error: false };
  // Never expose a previous descriptor, request, or transport's result, even
  // during the render before cancellation cleanup and the next effect run.
  return result?.key === key && result.invoker === invoker
    ? { record: result.record, loading: false, error: result.error }
    : { loading: true, error: false };
}
