// Compile against actual removal bindings, in both supported generation modes.
import { create } from "@bufbuild/protobuf";
import { AffordanceSchema, type Affordance } from "./proto/affordance_pb.js";
import { CommandSchema } from "./proto/command_palette_pb.js";
import { AffordanceCollectionSchema } from "./proto/interaction_pb.js";
import { FormPanelSchema, PanelDescriptorSchema } from "./proto/panel_pb.js";
import { RpcCallSchema } from "./proto/rpc_pb.js";
import { RowFilterSchema, TablePanelSchema } from "./proto/table_pb.js";
import { ActionPlacement, SlotSchema, ViewDescriptorSchema } from "./proto/view_pb.js";

const rpc = create(RpcCallSchema, { service: "canonical.Service", method: "Get",
  bindings: [{ requestField: "id", source: { case: "rowField", value: "id" } }] });
const actions: Affordance[] = [
  create(AffordanceSchema, { invoke: { case: "rpc", value: rpc } }),
  create(AffordanceSchema, { invoke: { case: "uri", value: "/raw" } }),
  create(AffordanceSchema, { invoke: { case: "command", value: "raw '$value'\n" } }),
  create(AffordanceSchema, { invoke: { case: "navigate", value: { route: "/form" } } }),
  create(AffordanceSchema, { invoke: { case: "openPanel", value: create(PanelDescriptorSchema) } }),
  create(AffordanceSchema, { invoke: { case: "openView", value: "raw-view" } }),
  create(AffordanceSchema, { invoke: { case: "copy", value: "" } }),
];
const action = create(AffordanceSchema, { ...actions[0], id: "run", label: "Run",
  placement: ActionPlacement.ROW, tone: 0, emphasis: 0, refreshOnSuccess: false,
  enabledWhen: create(RowFilterSchema, { fieldPath: "state", equals: "OPEN" }) });
const collection = create(AffordanceCollectionSchema, { items: [action] });
const slot = create(SlotSchema, { affordances: collection });
const view = create(ViewDescriptorSchema, { slots: [slot], affordances: collection });
const command = create(CommandSchema, { title: "Search title", affordance: action });
const table = create(TablePanelSchema, { affordances: collection });
const form = create(FormPanelSchema, { submitAffordance: action });
const label: string = form.submitAffordance!.label;
// @ts-expect-error Canonical facade types must not erode to any.
const invalid: number = view.affordances!.items[0].label;
// @ts-expect-error Removed invocation fields must not reappear in typed readers.
void form.submit;
// @ts-expect-error Removed collection fields must not reappear in typed readers.
void table.actions;
// @ts-expect-error Removed command oneof must not reappear in typed readers.
void command.action;
// @ts-expect-error Removed emphasis field must not reappear in typed readers.
void action.style;
// @ts-expect-error Removed message exports must not be compatibility shims.
import type { Action } from "./proto/view_pb.js";
// @ts-expect-error Removed message exports must not be compatibility shims.
import type { RowAction } from "./proto/table_pb.js";
// @ts-expect-error Removed message exports must not be compatibility shims.
import type { OpenPanel } from "./proto/command_palette_pb.js";
// @ts-expect-error Removed enum exports must not be compatibility shims.
import { AffordanceStyle } from "./proto/affordance_pb.js";
void [label, invalid, actions, command, table, slot, ActionPlacement];
