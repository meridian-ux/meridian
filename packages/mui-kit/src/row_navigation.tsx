import { create } from "@bufbuild/protobuf";
import { ActionSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { normalizeLegacyAction } from "@savvifi/meridian-schemas/uiview";
import { useActionGroup, useActionInvocation } from "@savvifi/meridian-web-react";
import { Button, TableCell, TableRow, Typography } from "@mui/material";
import { useId, type ReactNode } from "react";

const OPEN = normalizeLegacyAction(create(ActionSchema, { id: "open", label: "Open" }));

/** Implicit entity navigation is semantic intent, never a legacy callback grant. */
export function AdmittedNavigationRow({ row, subjectKind, children }: {
  row: Record<string, unknown>; subjectKind: string; children: ReactNode;
}): ReactNode {
  const ownId = Object.getOwnPropertyDescriptor(row, "id");
  const id = ownId && "value" in ownId ? ownId.value : undefined;
  const valid = typeof id === "string" && id.length > 0 || typeof id === "number" && Number.isFinite(id);
  const invocation = useActionInvocation(OPEN, { row,
    subject: { entityType: subjectKind, entityId: valid ? id as string | number : undefined }, enabled: valid });
  const group = useActionGroup();
  const owner = useId();
  const blocked = !valid || invocation.unavailable || group?.owner !== undefined && group.owner !== owner;
  const message = !valid ? "Open unavailable: this row has no supported identifier." : invocation.feedback;
  const activate = (trigger: HTMLElement) => {
    if (blocked || invocation.pending || group && !group.acquire(owner)) return;
    void invocation.activate(trigger).finally(() => group?.release(owner));
  };
  return <TableRow hover sx={!blocked ? { cursor: "pointer" } : undefined}
    aria-busy={invocation.pending || undefined}
    onClick={event => {
      // Link/menu/selection controls retain their own gestures. Never execute
      // two destinations from one bubbling interaction.
      if (event.target instanceof Element && event.target.closest("a,button,input,select,textarea,[role=button],[role=menuitem],[contenteditable=true]")) return;
      const button = event.currentTarget.querySelector<HTMLButtonElement>("button[data-mer-row-open]");
      if (button) activate(button);
    }}>
    <TableCell>
      <Button type="button" data-mer-row-open="" size="small" disabled={blocked}
        aria-label={valid ? `Open ${subjectKind} ${String(id)}` : "Open row"}
        aria-disabled={invocation.pending || undefined} aria-busy={invocation.pending || undefined}
        aria-describedby={message ? invocation.feedbackId : undefined}
        onClick={event => { event.stopPropagation(); activate(event.currentTarget); }}>Open</Button>
      {message && <Typography component="span" variant="caption" id={invocation.feedbackId}
        role={!valid || invocation.unavailable || invocation.outcome?.status === "denied" || invocation.outcome?.status === "failed" ? "alert" : "status"}>{message}</Typography>}
      {invocation.pending && <Button type="button" onClick={event => {
        event.stopPropagation(); invocation.cancel(event.currentTarget);
      }}>Cancel action</Button>}
    </TableCell>
    {children}
  </TableRow>;
}
