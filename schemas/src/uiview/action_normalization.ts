import { create } from "@bufbuild/protobuf";
import { AffordanceSchema, Emphasis, type Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { ActionPlacement, type Action, type Slot, type ViewDescriptor } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { TablePanel, RowAction } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { Command } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import type { FormPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";

/** In-process UI projection, never a serialized request/cache/audit DTO.
 * Descriptor data remains canonical protobuf. A no-call legacy Action retains
 * its original semantic key and subject needs; no destination is invented.
 * Only the activation dispatcher may ask the host's pure resolver for intent.
 */
export class NormalizedAction {
  constructor(readonly affordance: Affordance, readonly semanticAction?: Action,
    readonly legacyOrigin?: "action" | "row") {}
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

export function normalizeLegacyAction(action: Action): NormalizedAction {
  return new NormalizedAction(create(AffordanceSchema, {
    id: action.id, label: action.label, placement: action.placement,
    // The old PRIMARY placement also selected primary button prominence.
    // Keep its old region and carry that prominence separately, not as color.
    emphasis: action.placement === ActionPlacement.PRIMARY ? Emphasis.PRIMARY : undefined,
    invoke: action.call === undefined ? undefined : { case: "rpc", value: action.call },
  }), action.call === undefined ? action : undefined, "action");
}

export function normalizeLegacyRowAction(action: RowAction): NormalizedAction {
  return new NormalizedAction(create(AffordanceSchema, {
    label: action.label, placement: ActionPlacement.ROW,
    invoke: action.rpc === undefined ? undefined : { case: "rpc", value: action.rpc },
    enabledWhen: action.enabledWhen,
    // Both existing browser renderers always refresh after success. The old
    // proto3 bool has no presence; false must not silently change that behavior.
    refreshOnSuccess: true,
  }), undefined, "row");
}

/** Presence wins as a unit, including an explicitly empty collection or intent. */
export function normalizeViewActions(source: Pick<ViewDescriptor | Slot, "actions" | "affordances">): readonly NormalizedAction[] {
  return source.affordances === undefined ? projectActions(source.actions, normalizeLegacyAction)
    : projectActions(source.affordances.items, normalizeAffordance);
}

export function normalizeTableActions(source: Pick<TablePanel, "actions" | "affordances">): readonly NormalizedAction[] {
  return source.affordances === undefined ? projectActions(source.actions, normalizeLegacyRowAction)
    : projectActions(source.affordances.items, normalizeAffordance);
}

/** Search/menu data stays on the original proto envelope, never flattened into
 * an invocation or merged into an explicitly supplied canonical action. */
export function normalizeCommand(command: Command): { envelope: Command; action: NormalizedAction } {
  if (command.affordance !== undefined) return { envelope: command, action: new NormalizedAction(command.affordance) };
  let invoke: Affordance["invoke"] = { case: undefined };
  switch (command.action.case) {
    case "rpc": invoke = { case: "rpc", value: command.action.value }; break;
    case "navigate": invoke = { case: "navigate", value: command.action.value }; break;
    case "openViewId": invoke = { case: "openView", value: command.action.value }; break;
    case "openPanel":
      if (command.action.value.panel !== undefined) invoke = { case: "openPanel", value: command.action.value.panel };
      break;
    case undefined: break;
    default: {
      const exhaustive: never = command.action;
      void exhaustive;
    }
  }
  return { envelope: command, action: new NormalizedAction(create(AffordanceSchema, {
    id: command.id, label: command.title, description: command.subtitle, icon: command.icon, invoke,
  })) };
}

/** The caller supplies its existing localized submit label. Field validation,
 * automatic form mappings, and bounded request construction remain separate;
 * no RpcCall is executed while selecting the intent. */
export function normalizeFormSubmit(form: FormPanel, legacyLabel: string): NormalizedAction {
  return new NormalizedAction(form.submitAffordance ?? create(AffordanceSchema, {
    label: legacyLabel, invoke: form.submit === undefined ? undefined : { case: "rpc", value: form.submit },
  }));
}
