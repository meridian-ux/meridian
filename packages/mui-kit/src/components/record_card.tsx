// MeridianRecordCard — the MUI realization of a RecordCardPanel: a read-only
// key/value card for one record (the entity "detail section"). It fetches the
// record (via the panel's `populate`, bound by the view's subject id) and renders
// each field as a label + its resolved value in a responsive grid — a clean
// read view, NOT the disabled-input FormPanel(READONLY) it replaces.

import { useContext, type ReactNode } from "react";

import { Box, Card, CardContent, Skeleton, Typography } from "@mui/material";

import { MeridianViewContext, useRecord, resolvePath } from "@savvifi/meridian-web-react";
import type { RecordCardPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

/** Render a resolved field value as display text (arrays joined; objects JSON). */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text === "" ? "—" : text;
}

export function MeridianRecordCard({
  panel,
  invoker,
}: {
  panel: RecordCardPanel;
  invoker: RpcInvoker;
}): ReactNode {
  const { subjectId } = useContext(MeridianViewContext);
  const { record, loading, error } = useRecord(panel.populate, panel.idField, subjectId, invoker);

  if (panel.fields.length === 0) {
    return null;
  }

  return (
    <Card variant="outlined" className="mer-record-card">
      <CardContent>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            columnGap: 3,
            rowGap: 2,
          }}
        >
          {panel.fields.map((field) => {
            const value = loading && !record ? undefined : resolvePath(record, field.fieldId);
            return (
              <Box key={field.fieldId}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {field.label || field.fieldId}
                </Typography>
                {loading && !record ? (
                  <Skeleton variant="text" width="60%" />
                ) : (
                  <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                    {error ? "—" : formatValue(value)}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </CardContent>
    </Card>
  );
}
