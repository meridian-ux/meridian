import { useRef, useState } from "react";
import { Alert, Typography } from "@mui/material";
import { useMeridian } from "@savvifi/meridian-web-react";
import { createAdmissionGate } from "@savvifi/meridian-schemas/uiview";

/** Feedback for host-admitted mutations. The guarded invoker remains authoritative. */
export function useActionFeedback() {
  const { admission } = useMeridian();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const denied = (call?: { service: string; method: string }) => Boolean(call &&
    !createAdmissionGate(admission).admits("mutation", call.service, call.method));
  const run = async (operation: () => unknown | Promise<unknown>, success?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try { await operation(); success?.(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { busy.current = false; setPending(false); }
  };
  const props = (call?: { service: string; method: string }) => ({
    disabled: pending,
    "aria-disabled": pending || denied(call),
    title: denied(call) ? "Unavailable: this action is not permitted." : undefined,
  });
  const denial = (call?: { service: string; method: string }) => denied(call)
    ? <Typography component="span" variant="caption" role="note">Unavailable: this action is not permitted.</Typography>
    : null;
  return { run, props, pending, feedback: error ? <Alert severity="error" role="alert">{error}</Alert> :
    pending ? <span role="status">Working…</span> : null, denial };
}
