import { create } from "@bufbuild/protobuf";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import { FormPanelSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FormContent } from "./form.js";
import type { FormFieldClasses } from "./form_fields.js";
import { LroResult, useLroLifecycle } from "./lro_lifecycle.js";

// Reuse the recursive collector; completion means the whole operation workflow,
// not merely an acknowledged start. The shared hook owns host RPC observation.
export function LroInputs({ panel, c, className }: { panel: LroPanel; c: FormFieldClasses; className: string }) {
  const operation = useLroLifecycle(panel);
  const form = create(FormPanelSchema, { mode: 2, fields: panel.inputs, submit: panel.start });
  return <><FormContent panel={form} c={c} className={className} submitLabel={panel.runButtonLabel || "Run"}
    submittingLabel="Running…" successLabel="" submissionKind="lro" onSubmitValues={operation.run} />
    {operation.message && <p role="status">{operation.message}</p>}
    {operation.error && <p role="alert">{operation.error}</p>}
    <LroResult panel={panel} source={operation.source} /></>;
}
