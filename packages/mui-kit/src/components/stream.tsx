// MeridianStream — the MUI baseline for StreamPanel.
//
// Streaming transport is host-owned and is not part of RpcInvoker. Until a
// host supplies a live stream component, the kit still renders the semantic
// stream surface and its authored empty-state copy rather than dropping the
// panel. A host can replace this optional ComponentKit slot with a live tail.

import type { ReactNode } from "react";

import { Card, CardContent } from "@mui/material";
import { StreamContent, type StreamPanelProps } from "@savvifi/meridian-web-react";

export function MeridianStream({ panel, descriptor }: Pick<StreamPanelProps, "panel"> & Partial<Pick<StreamPanelProps, "descriptor">>): ReactNode {
  return (
    <Card
      variant="outlined"
      className="mer-stream"
      aria-live="polite"
      data-follow-mode={panel.followMode}
    >
      <CardContent>
        <StreamContent panel={panel} descriptor={descriptor} />
      </CardContent>
    </Card>
  );
}
