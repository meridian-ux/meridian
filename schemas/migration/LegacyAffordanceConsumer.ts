// Frozen pre-canonical source contract. Compile unchanged against both descriptor
// worlds; new SDK source cannot meaningfully compile against missing new fields.
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AffordanceSchema } from "./proto/affordance_pb.js";
import { ActionPlacement, ActionSchema, SlotSchema, ViewDescriptorSchema } from "./proto/view_pb.js";
import { RowActionSchema, RowFilterSchema, TablePanelSchema } from "./proto/table_pb.js";
import { CommandSchema } from "./proto/command_palette_pb.js";
import { FormPanelSchema } from "./proto/panel_pb.js";
import { RpcCallSchema } from "./proto/rpc_pb.js";

const call = create(RpcCallSchema, { service: "legacy.Service", method: "Get", bindings: [
  { requestField: "subject", source: { case: "rowField", value: "raw.id" } },
] });
const action = create(ActionSchema, { id: "confirm-delete", label: "Delete", placement: ActionPlacement.ROW, call });
const row = create(RowActionSchema, { label: "Resolve", rpc: call,
  enabledWhen: create(RowFilterSchema, { fieldPath: "state", equals: "OPEN" }), refreshOnSuccess: false });
const command = create(CommandSchema, { id: "legacy", title: "Search title", subtitle: "Detail",
  keywords: ["raw", "terms"], icon: "action", shortcut: "$mod+k", deepLink: "/legacy",
  action: { case: "rpc", value: call } });
const slot = create(SlotSchema, { id: "slot", actions: [action] });
const view = create(ViewDescriptorSchema, { id: "view", slots: [slot], actions: [action] });
const table = create(TablePanelSchema, { actions: [row] });
const form = create(FormPanelSchema, { submit: call, itemNoun: "record" });
const affordance = create(AffordanceSchema, { id: "command", label: "Run", style: 1,
  tone: 0, emphasis: 0, invoke: { case: "command", value: "raw '$value'\n" } });
const decoded = fromBinary(ViewDescriptorSchema, toBinary(ViewDescriptorSchema, view));
const id: string = decoded.actions[0].id;
const label: string = row.label;
const refresh: boolean = row.refreshOnSuccess;
const keywords: string[] = command.keywords;
// @ts-expect-error A facade must not erase the old field type to any.
const invalid: number = action.label;
void [id, label, refresh, keywords, invalid, table, form, affordance];
