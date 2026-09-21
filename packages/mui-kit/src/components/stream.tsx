// MeridianStream — the MUI baseline for StreamPanel.
//
// Streaming transport is host-owned and is not part of RpcInvoker. Until a
// host supplies a live stream component, the kit still renders the semantic
// stream surface and its authored empty-state copy rather than dropping the
// panel. A host can replace this optional ComponentKit slot with a live tail.

import type { ReactNode } from "react";

import { Card, CardContent, Typography } from "@mui/material";

import type { StreamPanel } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";

export function MeridianStream({ panel }: { panel: StreamPanel }): ReactNode {
  return (
    <Card
      variant="outlined"
      className="mer-stream"
      aria-live="polite"
      data-follow-mode={panel.followMode}
    >
      <CardContent>
        <Typography className="mer-stream-placeholder" color="text.secondary">
          {panel.placeholder || `Waiting for ${panel.itemNoun || "stream"}...`}
        </Typography>
      </CardContent>
    </Card>
  );
}
