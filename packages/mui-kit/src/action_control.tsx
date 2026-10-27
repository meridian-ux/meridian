import { Button, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import { affordancePresentation, type NormalizedAction } from "@savvifi/meridian-schemas/uiview";
import { useActionGroup, useActionInvocation, type ActionInvocationOptions } from "@savvifi/meridian-web-react";
import { useId, useState, type ReactNode } from "react";

export function NormalizedRowActionsMenu({ actions, row, subjectKind, refresh }: {
  actions: readonly NormalizedAction[]; row: Record<string, unknown>; subjectKind?: string;
  refresh: NonNullable<ActionInvocationOptions["refresh"]>;
}): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = Object.getOwnPropertyDescriptor(row, "id");
  const entityId = id && "value" in id && (typeof id.value === "string" || typeof id.value === "number") ? id.value as string | number : undefined;
  return <>
    <IconButton size="small" aria-label="Row actions" aria-haspopup="menu" aria-expanded={!!anchor}
      onClick={event => { event.stopPropagation(); setAnchor(event.currentTarget); }}>&#8942;</IconButton>
    <Menu keepMounted anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
      {actions.map((action, index) => <MuiActionControl key={action.affordance.id || index} action={action} menuItem
        options={{ row, subject: { entityType: subjectKind, entityId }, refresh, enabled: !!anchor }}
        onSuccess={() => setAnchor(null)} />)}
    </Menu>
  </>;
}

export function MuiActionControl({ action, options, menuItem, onSuccess, autoFocus, tabIndex }: {
  action: NormalizedAction; options?: ActionInvocationOptions; menuItem?: boolean;
  onSuccess?: () => void; autoFocus?: boolean; tabIndex?: number;
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
  const props = {
    disabled: otherPending || invocation.unavailable || invocation.predicateDenied || missing,
    "aria-disabled": invocation.pending || invocation.policyDenied || invocation.predicateDenied || missing || undefined,
    "aria-busy": invocation.pending || undefined,
    "aria-describedby": message ? invocation.feedbackId : undefined,
    "aria-label": action.affordance.label.trim() ? undefined : "Action",
    "data-mer-tone": tone,
    "data-mer-emphasis": action.affordance.emphasis === undefined ? undefined : primary ? "primary" : "secondary",
    style,
    title: invocation.predicateDenied ? "Unavailable for this row." : undefined,
  };
  const activate = (control: HTMLElement) => { if (group && !group.acquire(owner)) return;
    void invocation.activate(control).then(result => {
    if (result?.status === "succeeded") onSuccess?.();
  }).finally(() => group?.release(owner)); };
  const status = message && <Typography component="span" id={invocation.feedbackId}
    role={invocation.unavailable || invocation.outcome?.status === "failed" || invocation.outcome?.status === "denied" ? "alert" : "status"} variant="caption">{message}</Typography>;
  if (menuItem) return <>
    <MenuItem {...props} autoFocus={autoFocus} tabIndex={tabIndex} onClick={event => { event.stopPropagation(); activate(event.currentTarget); }}>
      {action.affordance.label}
    </MenuItem>
    {status && <li role="none">{status}</li>}
    {invocation.pending && <MenuItem onClick={event => { event.stopPropagation(); invocation.cancel(event.currentTarget); }}>Cancel action</MenuItem>}
  </>;
  return <span className="mer-action-control">
    <Button {...props} type="button" size="small" variant={primary ? "contained" : "outlined"}
      onClick={event => activate(event.currentTarget)}>{action.affordance.label}</Button>
    {status}
    {invocation.pending && <Button type="button" size="small" onClick={event => invocation.cancel(event.currentTarget)}>Cancel action</Button>}
  </span>;
}
