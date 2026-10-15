import { create } from "@bufbuild/protobuf";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import { FormPanelSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FormContent } from "./form.js";
import type { FormFieldClasses } from "./form_fields.js";

// Start-input realization. Reuse the real recursive form collector/validator
// and mutation admission; a successful start is not operation completion.
// Full polling/result presentation remains a separate lifecycle obligation.
export function LroInputs({ panel, c, className }: { panel: LroPanel; c: FormFieldClasses; className: string }) {
  const form = create(FormPanelSchema, { mode: 2, fields: panel.inputs, submit: panel.start });
  return <FormContent panel={form} c={c} className={className} submitLabel={panel.runButtonLabel || "Run"}
    submittingLabel="Starting…" successLabel="Started." />;
}
