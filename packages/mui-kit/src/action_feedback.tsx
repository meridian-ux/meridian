import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Typography } from "@mui/material";
import { useMeridian } from "@savvifi/meridian-web-react";
import { createAdmissionGate } from "@savvifi/meridian-schemas/uiview";

/** Feedback for host-admitted mutations. The guarded invoker remains authoritative. */
export function useActionFeedback(scope?: object) {
  const { admission } = useMeridian();
  const identity = useMemo(() => ({ scope }), [scope]);
  const current = useRef<typeof identity | undefined>(identity);
  const busy = useRef<typeof identity | undefined>(undefined);
  const [pendingIdentity, setPending] = useState<typeof identity>();
  const [failure, setFailure] = useState<{ identity: typeof identity; error: string }>();
  // Activate only committed scopes; a suspended render must not replace the
  // identity of an action that remains on screen.
  useLayoutEffect(() => {
    current.current = identity;
    return () => { current.current = undefined; };
  }, [identity]);
  const pending = pendingIdentity === identity;
  const error = failure?.identity === identity ? failure.error : "";
  const denied = (call?: { service: string; method: string }) => Boolean(call &&
    !createAdmissionGate(admission).admits("mutation", call.service, call.method));
  const run = async (operation: () => unknown | Promise<unknown>, success?: () => void) => {
    if (busy.current === identity) return;
    busy.current = identity;
    setPending(identity);
    setFailure(undefined);
    try { await operation(); if (current.current === identity) success?.(); }
    catch (error) { if (current.current === identity) setFailure({ identity, error: error instanceof Error ? error.message : String(error) }); }
    finally {
      if (busy.current === identity) busy.current = undefined;
      if (current.current === identity) setPending(undefined);
    }
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
