import { create, fromBinary, fromJson, toBinary, type JsonObject } from "@bufbuild/protobuf";
import { expect, it } from "vitest";
import { AffordanceSchema, Emphasis } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { AffordanceCollectionSchema } from "@savvifi/meridian-proto-ts/proto/interaction_pb.js";
import { ActionPlacement, ActionSchema, SlotSchema, ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { RowActionSchema, TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { CommandSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { FormPanelSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { normalizeAffordance, normalizeLegacyAction, normalizeLegacyRowAction, normalizeViewActions,
  normalizeTableActions, normalizeCommand, normalizeFormSubmit } from "./action_normalization.js";

const call = create(RpcCallSchema, { service: "raw.Service", method: "Get", bindings: [
  { requestField: "subject", source: { case: "rowField", value: "raw.e\u0301" } },
] });

it("direct Affordance keeps every typed target and policy field as one untouched proto", () => {
  const cases: JsonObject[] = [{ uri: "/raw" }, { command: "raw '$argument'\n" },
    { copy: "" }, { rpc: { service: "raw.Service", method: "Get" } },
    { navigate: { route: "/raw/e\u0301" } }, { openView: "view-id" }, { openPanel: { panelId: "inline" } }];
  for (const invoke of cases) {
    const source = fromJson(AffordanceSchema, { label: "", tone: 0, emphasis: 999, placement: 0,
      refreshOnSuccess: false, ...invoke });
    const bytes = toBinary(AffordanceSchema, source);
    const result = normalizeAffordance(source);
    expect(result.affordance).toBe(source);
    expect(result.semanticAction).toBeUndefined();
    expect(toBinary(AffordanceSchema, result.affordance)).toEqual(bytes);
  }
});

it.each([0, 1, 2, 3, 4, 999])("preserves legacy Action placement %s and exact RPC data without mutation", placement => {
  const source = create(ActionSchema, { id: " raw\0e\u0301 ", label: "Confirm first", placement, call });
  const bytes = toBinary(ActionSchema, source);
  const normalized = normalizeLegacyAction(source);
  expect(normalized.affordance).toMatchObject({ id: source.id, label: source.label, placement,
    invoke: { case: "rpc", value: call } });
  expect(normalized.semanticAction).toBeUndefined();
  expect(normalized.affordance.emphasis).toBe(placement === ActionPlacement.PRIMARY ? Emphasis.PRIMARY : undefined);
  expect(toBinary(ActionSchema, source)).toEqual(bytes);
});

it("keeps no-call IDs as semantic keys, never URI/view/command guesses", () => {
  for (const id of ["confirm-delete", "https://example.test", "view/raw", "raw '$argument'", ""]) {
    const source = create(ActionSchema, { id, label: "Host meaning", placement: ActionPlacement.HEADER });
    const normalized = normalizeLegacyAction(source);
    expect(normalized.affordance.id).toBe(id);
    expect(normalized.affordance.invoke.case).toBeUndefined();
    expect(normalized.semanticAction).toBe(source);
  }
  const invalidCall = create(ActionSchema, { id: "do-not-resolve", call: {} });
  expect(normalizeLegacyAction(invalidCall).semanticAction).toBeUndefined();
  expect(normalizeLegacyAction(invalidCall).affordance.invoke.case).toBe("rpc");
});

it("canonical view/slot presence wins, including empty overrides and unusable intents", () => {
  for (const schema of [ViewDescriptorSchema, SlotSchema]) {
    const source = create(schema, { id: "root", actions: [{ id: "semantic", label: "Legacy" }] });
    expect(normalizeViewActions(source)[0].semanticAction?.id).toBe("semantic");
    source.affordances = create(AffordanceCollectionSchema);
    expect(normalizeViewActions(fromBinary(schema, toBinary(schema, source)))).toEqual([]);
    const empty = create(AffordanceSchema);
    source.affordances.items = [empty];
    const [normalized] = normalizeViewActions(source);
    expect(normalized.affordance).toBe(empty);
    expect(normalized.affordance.label).toBe("");
    expect(normalized.semanticAction).toBeUndefined();
  }
});

it.each([false, true])("legacy RowAction refresh %s preserves actual always-refresh behavior", refreshOnSuccess => {
  const source = create(RowActionSchema, { label: "Resolve", rpc: call,
    enabledWhen: { fieldPath: "state", equals: "OPEN" }, refreshOnSuccess });
  const bytes = toBinary(RowActionSchema, source);
  const normalized = normalizeLegacyRowAction(source).affordance;
  expect(normalized).toMatchObject({ label: source.label, placement: ActionPlacement.ROW,
    enabledWhen: source.enabledWhen, refreshOnSuccess: true, invoke: { case: "rpc", value: call } });
  expect(normalizeTableActions(create(TablePanelSchema, { actions: [source] }))[0].affordance).toEqual(normalized);
  const missing = normalizeLegacyRowAction(create(RowActionSchema));
  expect(missing.affordance.invoke.case).toBeUndefined();
  expect(missing.semanticAction).toBeUndefined();
  expect(toBinary(RowActionSchema, source)).toEqual(bytes);
});

it("canonical table actions retain explicit false/zero/empty instead of merging legacy policy", () => {
  const source = create(TablePanelSchema, { actions: [{ label: "Legacy", rpc: call, refreshOnSuccess: true }],
    affordances: { items: [{ label: "", tone: 0, emphasis: 0, placement: 0, refreshOnSuccess: false,
      invoke: { case: "copy", value: "" } }] } });
  const wire = toBinary(TablePanelSchema, source);
  const normalized = normalizeTableActions(fromBinary(TablePanelSchema, wire));
  expect(normalized).toHaveLength(1);
  expect(normalized[0].affordance).toMatchObject({ label: "", tone: 0, emphasis: 0, placement: 0,
    refreshOnSuccess: false, invoke: { case: "copy", value: "" } });
  source.affordances!.items = [];
  expect(normalizeTableActions(source)).toEqual([]);
});

it("rejects excessive selected collections before projection, without reviving ignored legacy actions", () => {
  const many = Array.from({ length: 1001 }, () => create(ActionSchema, { id: "legacy" }));
  expect(() => normalizeViewActions({ actions: many })).toThrow("Action collection exceeds limits.");
  expect(normalizeViewActions({ actions: many, affordances: create(AffordanceCollectionSchema) })).toEqual([]);
  const rows = many.map(() => create(RowActionSchema));
  expect(() => normalizeTableActions({ actions: rows })).toThrow("Action collection exceeds limits.");
  const canonical = create(AffordanceCollectionSchema, { items: many.map(() => create(AffordanceSchema)) });
  expect(() => normalizeTableActions({ actions: [], affordances: canonical })).toThrow("Action collection exceeds limits.");
  expect(normalizeViewActions({ actions: many.slice(0, 1000) })).toHaveLength(1000);
});

it("adapts every legacy palette target while retaining the full search/menu envelope", () => {
  const sources = [
    create(CommandSchema, { action: { case: "rpc", value: call } }),
    create(CommandSchema, { action: { case: "navigate", value: { route: "/raw/e\u0301" } } }),
    create(CommandSchema, { action: { case: "openViewId", value: "view/e\u0301" } }),
    create(CommandSchema, { action: { case: "openPanel", value: { panel: { panelId: "inline" } } } }),
    create(CommandSchema, { action: { case: "openPanel", value: {} } }),
    create(CommandSchema),
  ];
  for (const [index, source] of sources.entries()) {
    Object.assign(source, { id: "id", title: "Search title", subtitle: "Detail", keywords: ["one", "two"],
      icon: "glyph", shortcut: "$mod+k", deepLink: "/search?raw=e\u0301" });
    const bytes = toBinary(CommandSchema, source);
    const result = normalizeCommand(source);
    expect(result.envelope).toBe(source);
    expect(result.action.affordance.invoke.case).toBe(["rpc", "navigate", "openView", "openPanel", undefined, undefined][index]);
    expect(result.action.affordance).toMatchObject({ id: source.id, label: source.title, description: source.subtitle, icon: source.icon });
    expect(toBinary(CommandSchema, source)).toEqual(bytes);
  }
});

it("canonical empty command/form messages prohibit legacy target and label revival", () => {
  const command = create(CommandSchema, { title: "Search envelope", action: { case: "rpc", value: call }, affordance: {} });
  expect(normalizeCommand(command).action.affordance).toBe(command.affordance);
  expect(normalizeCommand(command).action.affordance.invoke.case).toBeUndefined();
  expect(normalizeCommand(command).action.affordance.label).toBe("");
  const form = create(FormPanelSchema, { submit: call });
  expect(normalizeFormSubmit(form, "Save record").affordance).toMatchObject({ label: "Save record", invoke: { case: "rpc", value: call } });
  form.submitAffordance = create(AffordanceSchema);
  expect(normalizeFormSubmit(form, "Must not revive").affordance).toBe(form.submitAffordance);
  expect(normalizeFormSubmit(form, "Must not revive").affordance.invoke.case).toBeUndefined();
  expect(normalizeFormSubmit(create(FormPanelSchema), "Submit").affordance.invoke.case).toBeUndefined();
});
