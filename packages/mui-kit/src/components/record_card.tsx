// MeridianRecordCard — the MUI realization of a RecordCardPanel: a read-only
// key/value card for one record (the entity "detail section"). It fetches the
// record (via the panel's `populate`, bound by the view's subject id) and renders
// each field as a label + its resolved value in a responsive grid — a clean
// read view, NOT the disabled-input FormPanel(READONLY) it replaces.

import { useContext, type ReactNode } from "react";

import { Box, Card, CardContent, Chip, Skeleton, Stack, Typography } from "@mui/material";

import { MeridianViewContext, useRecord, resolvePath } from "@savvifi/meridian-web-react";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { RecordCardPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { EMPTY_DISPLAY, displayValueList, formatDisplayValue } from "../display_format.js";

/**
 * A value-set reference renders as a chip, not as bare text.
 *
 * `enumSelection` is the descriptor's existing signal for "this value comes from
 * a bounded set" (a status, a priority, a role) — the projection already emits it
 * for every `refKind`-backed field. A status reads as a token, not a sentence, so
 * a chip is the honest shape; free text stays typography.
 *
 * NOTE (next release): this is decided from the field's INPUT kind because that
 * is the only signal FormField carries. A table column answers the same question
 * from `ColumnFormat`/`ColumnLink` instead — two vocabularies for one concept
 * ("how does this value render"). Unifying them behind a shared value-display
 * spec, referenced by both TableColumn and FormField, is the follow-up; this
 * file and `display_format.ts` are where a cell and a card field would meet.
 */
function isValueSetRef(field: FormField): boolean {
  return field.kind.case === "enumSelection";
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
            const chips = isValueSetRef(field) && !error ? displayValueList(value) : [];
            return (
              <Box key={field.fieldId}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {field.label || field.fieldId}
                </Typography>
                {loading && !record ? (
                  <Skeleton variant="text" width="60%" />
                ) : chips.length > 0 ? (
                  // Wraps: a repeated reference (roles, tags) is several chips.
                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", mt: 0.25 }}>
                    {chips.map((chip) => (
                      <Chip key={chip} label={chip} size="small" variant="outlined" />
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                    {error ? EMPTY_DISPLAY : formatDisplayValue(value)}
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
