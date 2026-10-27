import { create, fromBinary, fromJson, toBinary, type JsonObject } from "@bufbuild/protobuf";
import { expect, it } from "vitest";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { AffordanceCollectionSchema } from "@savvifi/meridian-proto-ts/proto/interaction_pb.js";
import { ActionPlacement, SlotSchema, ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { CommandSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { FormPanelSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { normalizeAffordance, normalizeViewActions,
  normalizeTableActions, normalizeCommand, normalizeFormSubmit } from "./action_normalization.js";
import { readFrozen } from "../../tests/frozen_affordance.js";

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
    expect(toBinary(AffordanceSchema, result.affordance)).toEqual(bytes);
  }
});

it.each([0, 1, 2, 3, 4, 999])("preserves canonical placement %s and exact RPC data without mutation", placement => {
  const source = create(AffordanceSchema, { id: " raw\0e\u0301 ", label: "Confirm first", placement, invoke: { case: "rpc", value: call } });
  const bytes = toBinary(AffordanceSchema, source);
  const normalized = normalizeAffordance(source);
  expect(normalized.affordance).toMatchObject({ id: source.id, label: source.label, placement,
    invoke: { case: "rpc", value: call } });
  expect(normalized.affordance.emphasis).toBeUndefined();
  expect(toBinary(AffordanceSchema, source)).toEqual(bytes);
});

it("never guesses URI/view/command targets from no-call IDs", () => {
  for (const id of ["confirm-delete", "https://example.test", "view/raw", "raw '$argument'", ""]) {
    const source = create(AffordanceSchema, { id, label: "Host meaning", placement: ActionPlacement.HEADER });
    const normalized = normalizeAffordance(source);
    expect(normalized.affordance.id).toBe(id);
    expect(normalized.affordance.invoke.case).toBeUndefined();
  }
  const invalidCall = create(AffordanceSchema, { id: "do-not-resolve", invoke: { case: "rpc", value: {} } });
  expect(normalizeAffordance(invalidCall).affordance.invoke.case).toBe("rpc");
});

it("canonical view/slot presence wins, including empty overrides and unusable intents", () => {
  for (const schema of [ViewDescriptorSchema, SlotSchema]) {
    const source = readFrozen(schema, { id: "root", actions: [{ id: "semantic", label: "Legacy" }] });
    expect(normalizeViewActions(source)).toEqual([]);
    source.affordances = create(AffordanceCollectionSchema);
    expect(normalizeViewActions(fromBinary(schema, toBinary(schema, source)))).toEqual([]);
    const empty = create(AffordanceSchema);
    source.affordances.items = [empty];
    const [normalized] = normalizeViewActions(source);
    expect(normalized.affordance).toBe(empty);
    expect(normalized.affordance.label).toBe("");
  }
});

it.each([false, true])("canonical row refresh %s remains authoritative", refreshOnSuccess => {
  const source = create(AffordanceSchema, { label: "Resolve", placement: ActionPlacement.ROW, invoke: { case: "rpc", value: call },
    enabledWhen: { fieldPath: "state", equals: "OPEN" }, refreshOnSuccess });
  const bytes = toBinary(AffordanceSchema, source);
  const normalized = normalizeAffordance(source).affordance;
  expect(normalized).toMatchObject({ label: source.label, placement: ActionPlacement.ROW,
    enabledWhen: source.enabledWhen, refreshOnSuccess, invoke: { case: "rpc", value: call } });
  expect(normalizeTableActions(create(TablePanelSchema, { affordances: { items: [source] } }))[0].affordance).toEqual(normalized);
  const missing = normalizeAffordance(create(AffordanceSchema));
  expect(missing.affordance.invoke.case).toBeUndefined();
  expect(toBinary(AffordanceSchema, source)).toEqual(bytes);
});

it("canonical table actions retain explicit false/zero/empty instead of merging legacy policy", () => {
  const source = readFrozen(TablePanelSchema, { actions: [{ label: "Legacy", rpc: { service: call.service, method: call.method }, refreshOnSuccess: true }],
    affordances: { items: [{ label: "", tone: 0, emphasis: 0, placement: 0, refreshOnSuccess: false,
      copy: "" }] } });
  const wire = toBinary(TablePanelSchema, source);
  const normalized = normalizeTableActions(fromBinary(TablePanelSchema, wire));
  expect(normalized).toHaveLength(1);
  expect(normalized[0].affordance).toMatchObject({ label: "", tone: 0, emphasis: 0, placement: 0,
    refreshOnSuccess: false, invoke: { case: "copy", value: "" } });
  source.affordances!.items = [];
  expect(normalizeTableActions(source)).toEqual([]);
});

it("rejects excessive selected collections before projection, without reviving retired wire actions", () => {
  const many = Array.from({ length: 1001 }, () => ({ id: "legacy" }));
  expect(normalizeViewActions(readFrozen(ViewDescriptorSchema, { actions: many }))).toEqual([]);
  expect(normalizeTableActions(readFrozen(TablePanelSchema, { actions: many.map(() => ({ label: "legacy" })) }))).toEqual([]);
  const canonical = create(AffordanceCollectionSchema, { items: many.map(() => create(AffordanceSchema)) });
  expect(() => normalizeTableActions({ affordances: canonical })).toThrow("Action collection exceeds limits.");
  expect(() => normalizeViewActions({ affordances: canonical })).toThrow("Action collection exceeds limits.");
  expect(normalizeViewActions({ affordances: create(AffordanceCollectionSchema, { items: canonical.items.slice(0, 1000) }) })).toHaveLength(1000);
});

it("keeps canonical palette targets and full search/menu envelopes without reviving retired arms", () => {
  const sources = [
    create(CommandSchema, { affordance: { invoke: { case: "rpc", value: call } } }),
    create(CommandSchema, { affordance: { invoke: { case: "navigate", value: { route: "/raw/e\u0301" } } } }),
    create(CommandSchema, { affordance: { invoke: { case: "openView", value: "view/e\u0301" } } }),
    create(CommandSchema, { affordance: { invoke: { case: "openPanel", value: { panelId: "inline" } } } }),
    readFrozen(CommandSchema, { openPanel: {} }),
    create(CommandSchema),
  ];
  for (const [index, source] of sources.entries()) {
    Object.assign(source, { id: "id", title: "Search title", subtitle: "Detail", keywords: ["one", "two"],
      icon: "glyph", shortcut: "$mod+k", deepLink: "/search?raw=e\u0301" });
    const bytes = toBinary(CommandSchema, source);
    const result = normalizeCommand(source);
    expect(result.envelope).toBe(source);
    expect(result.action.affordance.invoke.case).toBe(["rpc", "navigate", "openView", "openPanel", undefined, undefined][index]);
    if (source.affordance) expect(result.action.affordance).toBe(source.affordance);
    else expect(result.action.affordance).toMatchObject({ id: source.id, label: source.title, description: source.subtitle, icon: source.icon });
    expect(toBinary(CommandSchema, source)).toEqual(bytes);
  }
});

it("canonical empty command/form messages prohibit legacy target and label revival", () => {
  const command = readFrozen(CommandSchema, { title: "Search envelope", rpc: { service: call.service, method: call.method }, affordance: {} });
  expect(normalizeCommand(command).action.affordance).toBe(command.affordance);
  expect(normalizeCommand(command).action.affordance.invoke.case).toBeUndefined();
  expect(normalizeCommand(command).action.affordance.label).toBe("");
  const form = readFrozen(FormPanelSchema, { submit: { service: call.service, method: call.method } });
  expect(normalizeFormSubmit(form, "Save record").affordance.label).toBe("Save record");
  expect(normalizeFormSubmit(form, "Save record").affordance.invoke.case).toBeUndefined();
  form.submitAffordance = create(AffordanceSchema);
  expect(normalizeFormSubmit(form, "Must not revive").affordance).toBe(form.submitAffordance);
  expect(normalizeFormSubmit(form, "Must not revive").affordance.invoke.case).toBeUndefined();
  expect(normalizeFormSubmit(create(FormPanelSchema), "Submit").affordance.invoke.case).toBeUndefined();
});
