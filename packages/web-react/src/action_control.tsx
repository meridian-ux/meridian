import { useId, type ReactNode } from "react";
import { affordancePresentation, type NormalizedAction } from "@savvifi/meridian-schemas/uiview";
import { useActionInvocation, type ActionInvocationOptions } from "./affordance_invocation.js";
import { useActionGroup } from "./action_group.js";

export function ActionControl({ action, options, className, menuItem, onSuccess }: {
  action: NormalizedAction; options?: ActionInvocationOptions; className?: string;
  menuItem?: boolean; onSuccess?: () => void;
}): ReactNode {
  const invocation = useActionInvocation(action, options);
  const group = useActionGroup();
  const owner = useId();
  const otherPending = group?.owner !== undefined && group.owner !== owner;
  const intent = action.affordance.invoke;
  const missing = intent.case === undefined || intent.case === "rpc" && (!intent.value.service || !intent.value.method);
  const message = invocation.feedback ?? (missing ? "Action unavailable: this target is missing or unsupported."
    : invocation.policyDenied ? "This action is unavailable." : undefined);
  const { primary, tone, style } = affordancePresentation(action.affordance);
  return <span className="mer-action-control">
    <button type="button" role={menuItem ? "menuitem" : undefined} className={className}
      style={style} data-mer-tone={tone} data-mer-emphasis={action.affordance.emphasis === undefined ? undefined : primary ? "primary" : "secondary"}
      aria-label={action.affordance.label.trim() ? undefined : "Action"}
      aria-disabled={invocation.pending || invocation.policyDenied || invocation.predicateDenied || missing || undefined}
      disabled={otherPending || invocation.unavailable || invocation.predicateDenied || missing}
      aria-busy={invocation.pending || undefined} aria-describedby={message ? invocation.feedbackId : undefined}
      onClick={event => { if (group && !group.acquire(owner)) return;
        void invocation.activate(event.currentTarget).then(result => {
        if (result?.status === "succeeded") onSuccess?.();
      }).finally(() => group?.release(owner)); }}>{action.affordance.label}</button>
    {message && <span id={invocation.feedbackId} role={invocation.unavailable || invocation.outcome?.status === "failed" || invocation.outcome?.status === "denied" ? "alert" : "status"}>{message}</span>}
    {invocation.pending && <button type="button" role={menuItem ? "menuitem" : undefined} onClick={event => invocation.cancel(event.currentTarget)}>Cancel action</button>}
  </span>;
}
