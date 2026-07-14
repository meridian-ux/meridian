// MeridianDetailHeader — the MUI realization of a DetailHeaderPanel: the header of
// a DETAIL view. It fetches the single record (via the panel's `populate`, bound by
// the view's subject id) and renders the record's title prominently, an optional
// subtitle + status chip, and a strip of labeled descriptor rows. Lifted from the
// old studio DetailSectionHeaderView pattern, minus its data-coupling — the record
// comes through the kit-agnostic `useRecord` hook.
//
// Header-level ACTIONS are NOT rendered here: they live on ViewDescriptor.actions
// (HEADER / OVERFLOW) and ViewRenderer paints them in the view header bar.

import { useContext, type ReactNode } from "react";

import { Box, Card, CardContent, Chip, Skeleton, Stack, Typography } from "@mui/material";

import { MeridianViewContext, useRecord, resolvePath } from "@savvifi/meridian-web-react";
import type { DetailHeaderPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

/** Map a status string to an MUI Chip color — best-effort by common vocabulary
 *  (kept in sync with the table's isStatusColumn coloring). */
function statusChipColor(value: string): "default" | "success" | "warning" | "error" {
  const v = value.toLowerCase();
  if (/(active|complete|approv|success|paid|done|resolved|enabled|live|ready)/.test(v)) return "success";
  if (/(pending|draft|open|in.?progress|review|waiting|processing|scheduled)/.test(v)) return "warning";
  if (/(error|fail|reject|cancel|declin|expired|disabled|inactive|blocked)/.test(v)) return "error";
  return "default";
}

/** Render a resolved value as display text (strings pass through; nulls → ""). */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function MeridianDetailHeader({
  panel,
  invoker,
}: {
  panel: DetailHeaderPanel;
  invoker: RpcInvoker;
}): ReactNode {
  const { subjectId } = useContext(MeridianViewContext);
  const { record, loading } = useRecord(panel.populate, panel.idField, subjectId, invoker);

  const resolvedTitle =
    (panel.titleSourcePath ? asText(resolvePath(record, panel.titleSourcePath)) : "") || panel.title;
  const subtitle = panel.subtitleSourcePath ? asText(resolvePath(record, panel.subtitleSourcePath)) : "";
  const status = panel.statusSourcePath ? asText(resolvePath(record, panel.statusSourcePath)) : "";
  const rows = panel.descriptorRows
    .map((row) => ({ label: row.label, value: asText(resolvePath(record, row.sourcePath)) }))
    .filter((row) => row.value !== "");

  return (
    <Card variant="outlined" className="mer-detail-header">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
          {loading && !resolvedTitle ? (
            <Skeleton variant="text" width={220} height={40} />
          ) : (
            <Typography variant="h5" component="h1" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
              {resolvedTitle || "—"}
            </Typography>
          )}
          {status ? (
            <Chip size="small" label={status} color={statusChipColor(status)} />
          ) : null}
        </Stack>
        {subtitle ? (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        ) : null}
        {rows.length > 0 ? (
          <Box
            sx={{
              mt: 2,
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(auto-fill, minmax(180px, 1fr))" },
              gap: 1.5,
            }}
          >
            {rows.map((row) => (
              <Box key={row.label}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {row.label}
                </Typography>
                <Typography variant="body2">{row.value}</Typography>
              </Box>
            ))}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
