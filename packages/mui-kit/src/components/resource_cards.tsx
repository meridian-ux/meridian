import { useState } from "react";
import type { ReactNode } from "react";

import { Alert, Box, Button, Card, CardContent, Chip, Link, Stack, Typography } from "@mui/material";
import type { ResourceAction, ResourceCardPanel } from "@savvifi/meridian-proto-ts/proto/resource_card_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { resolvePath, useHrefResolver, useMutationRpcInvoker, useResourceCardRows } from "@savvifi/meridian-web-react";
import { formatByDisplay, isSafeHttpUrl, resolveValueLink } from "../display_format.js";
import { useDisplayNow } from "../use_display_now.js";

function style(action: ResourceAction): "inherit" | "primary" | "error" {
  return action.style === 3 ? "error" : action.style === 2 ? "primary" : "inherit";
}

function visible(action: ResourceAction, row: Record<string, unknown>): boolean {
  if (!action.visibleWhen) return true;
  const match = /^([^=]+)==(.*)$/.exec(action.visibleWhen);
  return !!match && String(resolvePath(row, match[1].trim()) ?? "") === match[2].trim();
}

function requestFor(action: ResourceAction, row: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  for (const binding of action.invoke?.bindings ?? []) {
    const source = binding.source;
    const value = source.case === "rowField"
      ? resolvePath(row, source.value)
      : source.case === "literal" ? source.value : undefined;
    if (value !== undefined && value !== null) request[binding.requestField] = value;
  }
  return request;
}

export function MeridianResourceCards({
  panel,
  invoker,
}: {
  panel: ResourceCardPanel;
  invoker: RpcInvoker;
}): ReactNode {
  const { rows, loading, error } = useResourceCardRows(panel, invoker);
  const mutationInvoker = useMutationRpcInvoker();
  const resolveHref = useHrefResolver();
  const now = useDisplayNow();
  const [confirming, setConfirming] = useState<{ action: ResourceAction; row: Record<string, unknown> } | null>(null);
  if (loading) return <Typography color="text.secondary">Loading…</Typography>;
  if (error) return <Alert severity="error">Failed to load resources.</Alert>;
  if (!rows.length) return <Typography color="text.secondary">{panel.emptyMessage || `No ${panel.itemNoun || "resources"}.`}</Typography>;
  const template = panel.template;
  if (!template) return <Alert severity="error">Invalid resource card descriptor.</Alert>;
  const actions = template.actions?.actions ?? [];
  const invoke = (action: ResourceAction, row: Record<string, unknown>) => {
    if (action.invoke) {
      void mutationInvoker
        .invoke(action.invoke.service, action.invoke.method, requestFor(action, row))
        .catch(() => {});
    }
  };
  return (
    <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={2}>
      {rows.map((row, index) => {
        const slot = (path: string, display: Parameters<typeof formatByDisplay>[1]) => {
          const value = resolvePath(row, path);
          return display ? formatByDisplay(value, display, now) : { text: String(value ?? "") };
        };
        const title = slot(template.titleField, template.titleDisplay);
        const subtitle = slot(template.subtitleField, template.subtitleDisplay);
        const status = slot(template.statusField, template.statusDisplay);
        return (
        <Card variant="outlined" key={index}>
          <CardContent>
            <Stack spacing={1.25}>
              <Typography variant="h6" title={title.title}>{title.text}</Typography>
              {template.subtitleField && <Typography color="text.secondary" title={subtitle.title}>{subtitle.text}</Typography>}
              {template.statusField && <Chip size="small" label={status.text} title={status.title} sx={{ alignSelf: "flex-start" }} />}
              {template.meta.map((field, fieldIndex) => {
                const value = resolvePath(row, field.fieldPath);
                const shown = field.display ? formatByDisplay(value, field.display, now) : { text: String(value ?? "") };
                const link = resolveValueLink(value, field.display);
                const hostHref = link ? resolveHref?.(link.targetKind, link.id) : undefined;
                const external = !field.display?.link && isSafeHttpUrl(value, field.display);
                const href = hostHref || (external ? String(value) : undefined);
                return <Box key={`${field.fieldPath}:${fieldIndex}`} display="flex" justifyContent="space-between" gap={2}>
                  <Typography variant="caption" color="text.secondary">{field.label}</Typography>
                  {href ? <Link href={href} title={shown.title} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>{shown.text}</Link>
                    : <Typography variant="body2" title={shown.title}>{shown.text}</Typography>}
                </Box>;
              })}
              <Stack direction="row" gap={1} flexWrap="wrap">
                {actions.filter((action) => visible(action, row)).map((action) => (
                  <Box key={action.id}>
                    <Button size="small" color={style(action)} variant={action.style === 2 ? "contained" : "outlined"} onClick={() => action.confirm ? setConfirming({ action, row }) : invoke(action, row)}>
                      {action.label}
                    </Button>
                    {confirming?.action === action && confirming.row === row && (
                      <Alert severity={action.confirm?.destructive ? "warning" : "info"} role="alertdialog" sx={{ mt: 1 }}>
                        <Typography variant="subtitle2">{action.confirm?.title}</Typography>
                        <Typography variant="body2" sx={{ mb: 1 }}>{action.confirm?.message}</Typography>
                        <Stack direction="row" gap={1}>
                          <Button size="small" color="error" onClick={() => { setConfirming(null); invoke(action, row); }}>{action.confirm?.confirmLabel || "Confirm"}</Button>
                          <Button size="small" onClick={() => setConfirming(null)}>Cancel</Button>
                        </Stack>
                      </Alert>
                    )}
                  </Box>
                ))}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
        );
      })}
    </Box>
  );
}
