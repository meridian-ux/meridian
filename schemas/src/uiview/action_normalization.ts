import { create } from "@bufbuild/protobuf";
import { AffordanceSchema, type Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { Slot, ViewDescriptor } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { Command } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import type { FormPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";

/** In-process projection only. Protobuf intent never grants permission. */
export class NormalizedAction {
  constructor(readonly affordance: Affordance) {}
}

export function normalizeAffordance(action: Affordance): NormalizedAction {
  return new NormalizedAction(action);
}

// Match the existing view-composition node ceiling before allocating projected
// controls. Renderers still need their aggregate mounted-footprint accounting.
function projectActions<T>(items: readonly T[], project: (item: T) => NormalizedAction): NormalizedAction[] {
  if (items.length > 1000) throw new Error("Action collection exceeds limits.");
  return items.map(project);
}

/** Presence wins as a unit, including an explicitly empty collection or intent. */
export function normalizeViewActions(source: Pick<ViewDescriptor | Slot, "affordances">): readonly NormalizedAction[] {
  return projectActions(source.affordances?.items ?? [], normalizeAffordance);
}

export function normalizeTableActions(source: Pick<TablePanel, "affordances">): readonly NormalizedAction[] {
  return projectActions(source.affordances?.items ?? [], normalizeAffordance);
}

/** Search/menu data stays on the original proto envelope, never flattened into
 * an invocation or merged into an explicitly supplied canonical action. */
export function normalizeCommand(command: Command): { envelope: Command; action: NormalizedAction } {
  if (command.affordance !== undefined) return { envelope: command, action: new NormalizedAction(command.affordance) };
  return { envelope: command, action: new NormalizedAction(create(AffordanceSchema, {
    id: command.id, label: command.title, description: command.subtitle, icon: command.icon,
  })) };
}

/** The caller supplies its existing localized submit label. Field validation,
 * automatic form mappings, and bounded request construction remain separate;
 * no RpcCall is executed while selecting the intent. */
export function normalizeFormSubmit(form: FormPanel, fallbackLabel: string): NormalizedAction {
  return form.submitAffordance === undefined ? new NormalizedAction(create(AffordanceSchema, {
    label: fallbackLabel,
  })) : new NormalizedAction(form.submitAffordance);
}
