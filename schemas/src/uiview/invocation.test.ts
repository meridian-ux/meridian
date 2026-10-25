import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { expect, it, vi } from "vitest";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { CommandSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { normalizeAffordance, normalizeCommand } from "./action_normalization.js";
import { readFrozen } from "../../tests/frozen_affordance.js";
import { createInvocationDispatcher, type InvocationSnapshot, type InvocationCapabilities } from "./invocation.js";
import type { RpcInvoker } from "./transport.js";

const context = () => ({ currentResourcePath: "raw/e\u0301", uiIdentity: null,
  selectedRow: { id: "raw-row", state: "OPEN" }, formValues: {}, selections: { tenant: "raw-tenant" } });
const rpc: JsonObject = { rpc: { service: "raw.Service", method: "Get", bindings: [
  { requestField: "id", rowField: "id" }, { requestField: "tenant", selectionKey: "tenant" },
] } };

function setup(target: JsonObject = { copy: "raw\n'$payload' e\u0301" }) {
  const effects = { rpc: { invoke: vi.fn<NonNullable<InvocationCapabilities["rpc"]>["invoke"]>(async () => ({})) },
    uri: vi.fn<NonNullable<InvocationCapabilities["uri"]>>(async () => {}),
    command: vi.fn<NonNullable<InvocationCapabilities["command"]>>(async () => {}),
    navigate: vi.fn<NonNullable<InvocationCapabilities["navigate"]>>(async () => {}),
    openPanel: vi.fn<NonNullable<InvocationCapabilities["openPanel"]>>(async () => {}),
    openView: vi.fn<NonNullable<InvocationCapabilities["openView"]>>(async () => {}),
    copy: vi.fn<NonNullable<InvocationCapabilities["copy"]>>(async () => {}) } satisfies InvocationCapabilities;
  let snapshot: InvocationSnapshot | undefined = { action: normalizeAffordance(fromJson(AffordanceSchema, target)),
    context: context(), capabilities: effects, admit: vi.fn(() => true), admission: { mutations: ["raw.Service/Get"] },
    refresh: vi.fn(async () => {}) };
  const dispatcher = createInvocationDispatcher(() => snapshot);
  return { effects, dispatcher, get snapshot() { return snapshot!; },
    replace(next: InvocationSnapshot | undefined) { snapshot = next; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each<JsonObject>([rpc, { uri: "/safe" }, { command: "raw" }, { navigate: { route: "/safe" } },
  { openPanel: { panelId: "inline" } }, { openView: "view" }, { copy: "" }])(
  "host confirmation receives the admitted canonical %j and cannot be skipped", async target => {
    for (const accepted of [false, true]) {
      const host = setup(target), confirmIntent = vi.fn<NonNullable<InvocationSnapshot["confirmIntent"]>>(async () => accepted);
      host.replace({ ...host.snapshot, subject: { entityType: "Rows", entityId: 0 }, confirmIntent });
      expect(confirmIntent).not.toHaveBeenCalled();
      expect((await host.dispatcher.activate()).status).toBe(accepted ? "succeeded" : "cancelled");
      expect(confirmIntent).toHaveBeenCalledTimes(1);
      expect(confirmIntent).toHaveBeenCalledWith(host.snapshot.action.affordance, host.snapshot.context,
        { entityType: "Rows", entityId: 0 }, expect.any(AbortSignal));
      if (!accepted) expectNoEffects(host.effects);
    }
  });

it.each(["mutation", "target", "capability", "missing"])("host confirmation cannot grant %s admission", async reason => {
  const host = setup(reason === "missing" ? {} : rpc), confirmIntent = vi.fn(async () => true);
  host.replace({ ...host.snapshot, confirmIntent, admission: reason === "mutation" ? undefined : host.snapshot.admission,
    capabilities: reason === "capability" ? {} : host.effects, admit: () => reason !== "target" });
  expect((await host.dispatcher.activate()).status).toBe("denied"); expect(confirmIntent).not.toHaveBeenCalled(); expectNoEffects(host.effects);
});

it("typed host and adapter consent both run after admission in order", async () => {
  const host = setup(rpc), order: string[] = [], resolved = fromJson(AffordanceSchema, rpc);
  host.replace({ ...host.snapshot, action: normalizeAffordance(resolved),
    admit: () => { order.push("admission"); return true; },
    confirmIntent: async action => { expect(action).toBe(resolved); order.push("host"); return true; },
    confirm: async () => { order.push("adapter"); return true; } });
  expect((await host.dispatcher.activate()).status).toBe("succeeded"); expect(order).toEqual(["admission", "host", "adapter"]);
});

it.each(["scope", "cancel", "dispose", "reject"])("host confirmation handles %s without later adapter consent, effect, or refresh", async change => {
  const host = setup(rpc), consent = deferred<boolean>(), adapter = vi.fn(async () => true);
  const confirmIntent = vi.fn(() => consent.promise);
  host.replace({ ...host.snapshot, confirmIntent, confirm: adapter });
  const run = host.dispatcher.activate(); expect(confirmIntent).toHaveBeenCalledTimes(1);
  expect(await host.dispatcher.activate()).toEqual({ status: "busy" });
  if (change === "scope") host.replace({ ...host.snapshot });
  if (change === "cancel") host.dispatcher.cancel(); if (change === "dispose") host.dispatcher.dispose();
  if (change === "reject") consent.reject(Error("private consent details")); else consent.resolve(true);
  expect((await run).status).toBe(change === "scope" ? "stale" : change === "reject" ? "failed" : "cancelled");
  expect(adapter).not.toHaveBeenCalled(); expectNoEffects(host.effects); expect(host.snapshot.refresh).not.toHaveBeenCalled();
});

it.each([false, true])("adapter confirmation %s is consent after admission, never a grant", async accepted => {
  const host = setup(rpc); const confirm = vi.fn(async () => accepted);
  host.replace({ ...host.snapshot, confirm }); expect(confirm).not.toHaveBeenCalled();
  const result = await host.dispatcher.activate(); expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith(host.snapshot.context, expect.any(AbortSignal));
  expect(result.status).toBe(accepted ? "succeeded" : "cancelled"); expect(host.effects.rpc.invoke).toHaveBeenCalledTimes(accepted ? 1 : 0);
});

it.each(["mutation", "target", "capability", "missing target"])("does not ask adapter consent for %s denial", async reason => {
  const host = setup(reason === "missing target" ? {} : rpc); const confirm = vi.fn(async () => true);
  host.replace({ ...host.snapshot, confirm, admission: reason === "mutation" ? undefined : host.snapshot.admission,
    admit: () => reason !== "target", capabilities: reason === "capability" ? {} : host.effects });
  expect((await host.dispatcher.activate()).status).toBe("denied"); expect(confirm).not.toHaveBeenCalled(); expect(host.effects.rpc.invoke).not.toHaveBeenCalled();
});

it.each(["scope", "cancel", "dispose", "reject"])("adapter confirmation handles %s without an effect or refresh", async change => {
  const host = setup(rpc); const consent = deferred<boolean>(); const confirm = vi.fn(() => consent.promise);
  host.replace({ ...host.snapshot, confirm }); const run = host.dispatcher.activate(); expect(confirm).toHaveBeenCalledTimes(1);
  if (change === "scope") host.replace({ ...host.snapshot, context: { ...host.snapshot.context, selectedRow: { id: 0 } } });
  if (change === "cancel") host.dispatcher.cancel(); if (change === "dispose") host.dispatcher.dispose();
  if (change === "reject") consent.reject(Error("private consent failure")); else consent.resolve(true);
  expect((await run).status).toBe(change === "scope" ? "stale" : change === "reject" ? "failed" : "cancelled"); expect(host.effects.rpc.invoke).not.toHaveBeenCalled(); expect(host.snapshot.refresh).not.toHaveBeenCalled();
});

it.each(["form", "lro"] as const)("submits %s through the actual Rust automatic mapping builder", async kind => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get", bindings: [
    { requestField: "copied", formField: "name" }, { requestField: "forbidden", formField: "unmodeled" },
    { requestField: "row", rowField: "id" }, { requestField: "scope", selectionKey: "tenant" },
  ] } });
  const fields = [
    create(FormFieldSchema, { fieldId: "name", requestField: "payload.name", kind: { case: "text", value: {} } }),
    create(FormFieldSchema, { fieldId: "flag", requestField: "payload.flag", kind: { case: "boolean", value: {} } }),
  ];
  host.replace({ ...host.snapshot, submission: { fields, kind },
    context: { ...context(), selectedRow: { id: 0 }, formValues: { name: "raw/e\u0301", flag: false, unmodeled: "secret" } } });
  expect(await host.dispatcher.activate()).toEqual({ status: "succeeded", refresh: "not-requested" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", {
    copied: "raw/e\u0301", row: 0, scope: "raw-tenant",
    ...(kind === "form" ? { name: "raw/e\u0301", flag: false } : { payload: { name: "raw/e\u0301", flag: false } }),
  }, expect.any(AbortSignal));
});

it("form bindings win collisions while automatic field IDs remain literal, including dots", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get", bindings: [{ requestField: "name", literal: "bound" }] } });
  const fields = ["name", "raw.name"].map(fieldId => create(FormFieldSchema, { fieldId, requestField: "must.not.remap" }));
  host.replace({ ...host.snapshot, submission: { fields, kind: "form" },
    context: { ...context(), formValues: { name: "editable", "raw.name": "001.20" } } });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", { name: "bound", "raw.name": "001.20" }, expect.any(AbortSignal));
});

it("submission mode cannot grant mutation permission or touch declarations before denial", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get" } });
  const get = vi.fn(() => { throw new Error("must not read declarations"); });
  const field = create(FormFieldSchema);
  Object.defineProperty(field, "fieldId", { get });
  host.replace({ ...host.snapshot, admission: { reads: ["raw.Service/Get"] }, submission: { fields: [field], kind: "form" } });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "mutation-policy" });
  expect(get).not.toHaveBeenCalled(); expectNoEffects(host.effects);
});

it("submission uses the selected canonical call, never a legacy row default", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get" } });
  host.replace({ ...host.snapshot, submission: { fields: [], kind: "form" },
    context: { ...context(), selectedRow: { id: 0 } } });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", {}, expect.any(AbortSignal));
});

it.each(["prototype", "large", "invalid-kind"])("submission %s input fails without transport or a plain-builder fallback", async mode => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get" } });
  const fields = [create(FormFieldSchema, { fieldId: mode === "prototype" ? "__proto__" : "name" })];
  host.replace({ ...host.snapshot, submission: { fields, kind: mode === "invalid-kind" ? "unsupported" as "form" : "form" },
    context: { ...context(), formValues: mode === "large" ? { name: "x".repeat(5 * 1024 * 1024) } : { name: "raw" } } });
  expect(await host.dispatcher.activate()).toEqual({ status: "failed" });
  expectNoEffects(host.effects);
});

it("submission metadata cannot turn a denied or empty canonical target into an RPC", async () => {
  const host = setup({});
  host.replace({ ...host.snapshot, submission: { fields: [], kind: "form" } });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-target" });
  expectNoEffects(host.effects);
});

it("non-RPC form targets retain explicit admission and receive current validated form context", async () => {
  const host = setup({ copy: "literal" });
  const values = { name: "raw/e\u0301", flag: false };
  host.replace({ ...host.snapshot, submission: { fields: [], kind: "form" }, context: { ...context(), formValues: values } });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.copy, "literal", host.snapshot.context, expect.any(AbortSignal));
  expect(host.effects.rpc.invoke).not.toHaveBeenCalled();
});

function expectNoEffects(effects: ReturnType<typeof setup>["effects"]) {
  const { rpc: transport, ...rest } = effects;
  expect(transport.invoke).not.toHaveBeenCalled();
  for (const effect of Object.values(rest)) expect(effect).not.toHaveBeenCalled();
}

function expectOnceWith(callback: unknown, ...args: unknown[]) {
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith(...args);
}

it("constructing and inspecting a dispatcher performs no policy, confirmation, or IO", () => {
  const host = setup();
  const confirmIntent = vi.fn();
  host.replace({ ...host.snapshot, action: normalizeAffordance(create(AffordanceSchema, { id: "semantic" })), confirmIntent });
  expect(host.dispatcher.pending).toBe(false);
  expect(confirmIntent).not.toHaveBeenCalled();
  expect(host.snapshot.admit).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it.each([
  ["uri", { uri: "/raw/e\u0301?q=\"x\"" }],
  ["command", { command: "raw '$argument'\n" }],
  ["navigate", { navigate: { route: "/raw/e\u0301" } }],
  ["openPanel", { openPanel: { panelId: "inline" } }],
  ["openView", { openView: " raw-view " }],
  ["copy", { copy: "" }],
] as const)("executes only the explicitly admitted %s capability with the raw typed target", async (kind, data) => {
  const host = setup(data);
  const snapshot = host.snapshot;
  expect(await host.dispatcher.activate()).toEqual({ status: "succeeded", refresh: "not-requested" });
  expectOnceWith(host.effects[kind], snapshot.action.affordance.invoke.value, snapshot.context, expect.any(AbortSignal));
  expectOnceWith(snapshot.admit, snapshot.action.affordance.invoke, snapshot.context);
  const { rpc: transport, ...rest } = host.effects;
  expect(transport.invoke).not.toHaveBeenCalled();
  for (const [key, effect] of Object.entries(rest)) if (key !== kind) {
    expect(effect).not.toHaveBeenCalled();
  }
});

it("builds RPC bindings through the real Rust core with the activation's row and selections", async () => {
  const host = setup(rpc);
  host.replace({ ...host.snapshot, context: { ...context(), selectedRow: { id: "current-row" }, selections: { tenant: "current-tenant" } } });
  expect(await host.dispatcher.activate()).toEqual({ status: "succeeded", refresh: "not-requested" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get",
    { id: "current-row", tenant: "current-tenant" }, expect.any(AbortSignal));
});

it("existing three-argument RpcInvoker hosts remain source-compatible", async () => {
  const host = setup(rpc);
  const invoke = vi.fn<RpcInvoker["invoke"]>(async () => ({}));
  const legacy: RpcInvoker = { invoke };
  host.replace({ ...host.snapshot, capabilities: { rpc: legacy } });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expect(invoke).toHaveBeenCalledTimes(1);
});

it.each([false, true])("row id requires an authored binding (%s)", async bindId => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get", bindings: bindId ? [{ requestField: "id", rowField: "id" }] : [] } });
  host.replace({ ...host.snapshot, context: { ...context(), selectedRow: { id: 0 } } });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", bindId ? { id: 0 } : {}, expect.any(AbortSignal));
});

it("canonical requests do not invent id or replace authored bindings", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get" } });
  host.replace({ ...host.snapshot, context: { ...context(), selectedRow: { id: 0 } } });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", {}, expect.any(AbortSignal));
  host.effects.rpc.invoke.mockClear();
  host.replace({ ...host.snapshot, action: normalizeAffordance(fromJson(AffordanceSchema, {
    rpc: { service: "raw.Service", method: "Get", bindings: [{ requestField: "authored", literal: "raw" }] },
  })) });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", { authored: "raw" }, expect.any(AbortSignal));
});

it("canonical palette never invents a row id default", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeCommand(create(CommandSchema, {
    affordance: { invoke: { case: "rpc", value: { service: "raw.Service", method: "Get", bindings: [] } } },
  })).action, context: { ...context(), selectedRow: { id: 0 } } });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", {}, expect.any(AbortSignal));
});

it("canonical row request rejects accessors without evaluating them", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get" } });
  const get = vi.fn(() => "private");
  host.replace({ ...host.snapshot, context: { ...context(), selectedRow: Object.defineProperty({}, "id", { enumerable: true, get }) } });
  expect(await host.dispatcher.activate()).toEqual({ status: "failed" });
  expect(get).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("a retired palette RPC is not a canonical target even with an admitted host", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeCommand(readFrozen(CommandSchema, {
    id: "retired", rpc: { service: "raw.Service", method: "Get" },
  })).action });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-target" });
  expectNoEffects(host.effects);
});

it.each([undefined, { reads: ["*"] }, { mutations: [] }])("Get RPC never escapes mutation admission (%j)", async admission => {
  const host = setup(rpc);
  host.replace({ ...host.snapshot, admission });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "mutation-policy" });
  expectNoEffects(host.effects);
});

it("a stricter context-aware RPC policy cannot be skipped", async () => {
  const host = setup(rpc);
  host.replace({ ...host.snapshot, admit: () => false });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "target-policy" });
  expectNoEffects(host.effects);
});

it("retains the existing mutation denial hook without exposing its thrown error", async () => {
  const host = setup(rpc);
  const onDenied = vi.fn(() => { throw new Error("private observer detail"); });
  host.replace({ ...host.snapshot, admission: { onDenied } });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "mutation-policy" });
  expectOnceWith(onDenied, expect.objectContaining({ tier: "mutation", service: "raw.Service", method: "Get" }));
  expectNoEffects(host.effects);
});

it.each([undefined, () => false])("non-RPC policy defaults closed; there is no clipboard or legacy fallback", async admit => {
  const host = setup({ command: "private command" });
  host.replace({ ...host.snapshot, admit });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "target-policy" });
  expectNoEffects(host.effects);
});

it("missing capability does not invoke policy or substitute another target", async () => {
  const host = setup({ navigate: { route: "/raw" } });
  host.replace({ ...host.snapshot, capabilities: { copy: host.effects.copy } });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-capability" });
  expect(host.snapshot.admit).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it.each([{}, { uri: "" }, { command: "" }, { navigate: {} }, { openView: "" }, { rpc: {} }] as JsonObject[])(
  "missing/empty required target remains denied (%j)", async target => {
    const host = setup(target);
    expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-target" });
    expectNoEffects(host.effects);
  });

it("unknown plain-JS target is denied, not dispatched through a property name", async () => {
  const host = setup();
  // A deliberately invalid host cast, not a protobuf fixture for a known arm.
  const action = normalizeAffordance(create(AffordanceSchema));
  Object.assign(action.affordance, { invoke: { case: "constructor", value: "private" } });
  host.replace({ ...host.snapshot, action });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "unsupported-target" });
  expectNoEffects(host.effects);
});

it("evaluates enabled_when against the current row via Rust, not earlier paint", async () => {
  const host = setup({ copy: "raw", enabledWhen: { fieldPath: "state", equals: "OPEN" } });
  host.replace({ ...host.snapshot, context: { ...context(), selectedRow: { id: "different", state: "CLOSED" } } });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "disabled" });
  expect(host.snapshot.admit).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("explicit targets retain exact row/header subject context without resolving IDs", async () => {
  for (const subject of [{ entityType: "row", entityId: 0 }, { entityType: "header", entityId: "e\u0301" }]) {
    const host = setup();
    const confirmIntent = vi.fn<NonNullable<InvocationSnapshot["confirmIntent"]>>(async () => true);
    const resolved = fromJson(AffordanceSchema, { id: "https://not-a-destination.test", navigate: { route: "/form/subject" } });
    host.replace({ ...host.snapshot, action: normalizeAffordance(resolved), subject, confirmIntent });
    expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
    expectOnceWith(confirmIntent, resolved, host.snapshot.context, subject, expect.any(AbortSignal));
    expectOnceWith(host.effects.navigate, resolved.invoke.value, host.snapshot.context, expect.any(AbortSignal));
    expect(host.effects.rpc.invoke).not.toHaveBeenCalled();
  }
});

it.each<JsonObject>([rpc, { uri: "/safe" }, { command: "raw" }, { navigate: { route: "/safe" } },
  { openPanel: { panelId: "inline" } }, { openView: "view" }, { copy: "literal" }])(
  "admitted canonical %j preserves consent order and cancellation", async target => {
    for (const consent of [false, true]) {
      const host = setup(target), order: string[] = [];
      const semantic = vi.fn(async () => { order.push("host"); return consent; });
      const adapter = vi.fn(async () => { order.push("adapter"); return true; });
      host.replace({ ...host.snapshot,
        admit: () => { order.push("admission"); return true; }, confirm: adapter,
        confirmIntent: semantic });
      expect((await host.dispatcher.activate()).status).toBe(consent ? "succeeded" : "cancelled");
      expect(order).toEqual(consent ? ["admission", "host", "adapter"] : ["admission", "host"]);
      expect(semantic).toHaveBeenCalledTimes(1); expect(adapter).toHaveBeenCalledTimes(consent ? 1 : 0);
      if (!consent) expectNoEffects(host.effects);
      else {
        const kind = fromJson(AffordanceSchema, target).invoke.case!;
        const effect = kind === "rpc" ? host.effects.rpc.invoke : host.effects[kind];
        expect(effect).toHaveBeenCalledTimes(1);
      }
    }
  });

it.each([false, true])("denied canonical actions do not ask for confirmation %s or disguise denial as cancellation", async consent => {
  const host = setup(rpc);
  const confirm = vi.fn(async () => consent);
  host.replace({ ...host.snapshot, confirmIntent: confirm, admission: undefined });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "mutation-policy" });
  expect(confirm).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it.each(["mutation", "target", "capability", "missing", "disabled"])("canonical %s denial precedes both confirmation hooks", async reason => {
  const host = setup(rpc), semantic = vi.fn(async () => true), adapter = vi.fn(async () => true);
  const resolved = fromJson(AffordanceSchema, reason === "missing" ? {} : {
    ...rpc, ...(reason === "disabled" ? { enabledWhen: { fieldPath: "state", equals: "CLOSED" } } : {}),
  });
  host.replace({ ...host.snapshot, action: normalizeAffordance(resolved),
    confirmIntent: semantic, confirm: adapter,
    admission: reason === "mutation" ? undefined : host.snapshot.admission,
    admit: () => reason !== "target", capabilities: reason === "capability" ? {} : host.effects });
  const expected = { mutation: "mutation-policy", target: "target-policy", capability: "missing-capability", missing: "missing-target", disabled: "disabled" };
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: expected[reason as keyof typeof expected] });
  expect(semantic).not.toHaveBeenCalled(); expect(adapter).not.toHaveBeenCalled();
  expectNoEffects(host.effects); expect(host.snapshot.refresh).not.toHaveBeenCalled();
});

it("an ID-only canonical action visibly denies instead of treating the ID as a URI", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeAffordance(create(AffordanceSchema, { id: "/not-a-route" })) });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-target" });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-target" });
  expectNoEffects(host.effects);
});

it("an empty canonical ID cannot be confirmed into an executable default", async () => {
  const host = setup();
  const confirmIntent = vi.fn(async () => true);
  host.replace({ ...host.snapshot, action: normalizeAffordance(create(AffordanceSchema)), confirmIntent });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-target" });
  expect(confirmIntent).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("canonical denial never runs available host consent", async () => {
  const host = setup({ command: "denied" });
  const confirmIntent = vi.fn(async () => true);
  host.replace({ ...host.snapshot, confirmIntent, admit: () => false });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "target-policy" });
  expect(confirmIntent).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("scope changes during confirmation stop execution; retry resolves the new current subject", async () => {
  const host = setup();
  const consent = deferred<boolean>();
  const action = normalizeAffordance(fromJson(AffordanceSchema, { id: "confirm", copy: "first" }));
  host.replace({ ...host.snapshot, action, confirmIntent: () => consent.promise });
  const first = host.dispatcher.activate();
  expect(host.dispatcher.pending).toBe(true);
  expect(await host.dispatcher.activate()).toEqual({ status: "busy" });
  host.replace({ ...host.snapshot, subject: { entityId: "new" }, action: normalizeAffordance(fromJson(AffordanceSchema, { copy: "new" })), confirmIntent: async () => true });
  consent.resolve(true);
  expect(await first).toEqual({ status: "stale" });
  expectNoEffects(host.effects);
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.copy, "new", host.snapshot.context, expect.any(AbortSignal));
});

it("host policy replacing a capability or context cannot dispatch a captured target", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, admit: () => { host.replace({ ...host.snapshot, capabilities: {} }); return true; } });
  expect(await host.dispatcher.activate()).toEqual({ status: "stale" });
  expectNoEffects(host.effects);
});

it.each(["cancel", "dispose"] as const)("%s during a pending effect suppresses refresh and duplicate execution", async stop => {
  const host = setup({ copy: "private", refreshOnSuccess: true });
  const effect = deferred<void>();
  host.effects.copy.mockImplementation(() => effect.promise);
  const first = host.dispatcher.activate();
  host.dispatcher[stop]();
  expect(await host.dispatcher.activate()).toEqual({ status: stop === "dispose" ? "cancelled" : "busy" });
  effect.resolve();
  expect(await first).toEqual({ status: "cancelled" });
  expect(host.effects.copy).toHaveBeenCalledTimes(1);
  expect(host.snapshot.refresh).not.toHaveBeenCalled();
  expect(host.dispatcher.pending).toBe(false);
});

it("late completion after scope replacement/unmount cannot refresh the replacement", async () => {
  const host = setup({ copy: "old", refreshOnSuccess: true });
  const effect = deferred<void>();
  host.effects.copy.mockImplementation(() => effect.promise);
  const refresh = host.snapshot.refresh;
  const first = host.dispatcher.activate();
  host.replace(undefined);
  effect.resolve();
  expect(await first).toEqual({ status: "stale" });
  expect(refresh).not.toHaveBeenCalled();
  expect(await host.dispatcher.activate()).toEqual({ status: "stale" });
});

it("late failure after scope replacement is stale, not an error for the replacement", async () => {
  const host = setup();
  const effect = deferred<void>();
  host.effects.copy.mockImplementation(() => effect.promise);
  const first = host.dispatcher.activate();
  host.replace({ ...host.snapshot, context: context() });
  effect.reject(new Error("old private failure"));
  expect(await first).toEqual({ status: "stale" });
});

it("a missing refresh capability is reported separately from a successful effect", async () => {
  const host = setup({ copy: "raw", refreshOnSuccess: true });
  host.replace({ ...host.snapshot, refresh: undefined });
  expect(await host.dispatcher.activate()).toEqual({ status: "succeeded", refresh: "failed" });
  expect(host.effects.copy).toHaveBeenCalledTimes(1);
});

it("failures are sanitized and retry uses current input rather than replaying a stale closure", async () => {
  const host = setup({ copy: "secret-one", refreshOnSuccess: true });
  host.effects.copy.mockRejectedValueOnce(new Error("secret transport detail"));
  expect(await host.dispatcher.activate()).toEqual({ status: "failed" });
  expect(host.snapshot.refresh).not.toHaveBeenCalled();
  host.replace({ ...host.snapshot, action: normalizeAffordance(fromJson(AffordanceSchema, { copy: "secret-two" })) });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expect(host.effects.copy.mock.calls[1]?.[0]).toBe("secret-two");
});

it("invalid request input fails before authenticated transport and never leaks getter details", async () => {
  const host = setup(rpc);
  const get = vi.fn(() => { throw new Error("secret getter"); });
  const row = Object.defineProperty({}, "id", { enumerable: true, get });
  host.replace({ ...host.snapshot, context: { ...context(), selectedRow: row } });
  expect(await host.dispatcher.activate()).toEqual({ status: "failed" });
  expect(get).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("authored true refreshes; canonical false suppresses refresh; refresh failure does not replay IO", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeAffordance(fromJson(AffordanceSchema, {
    rpc: { service: "raw.Service", method: "Get" }, refreshOnSuccess: true,
  })) });
  expect(await host.dispatcher.activate()).toEqual({ status: "succeeded", refresh: "succeeded" });
  expect(host.snapshot.refresh).toHaveBeenCalledTimes(1);
  host.replace({ ...host.snapshot, action: normalizeAffordance(fromJson(AffordanceSchema, { copy: "raw", refreshOnSuccess: false })) });
  expect(await host.dispatcher.activate()).toEqual({ status: "succeeded", refresh: "not-requested" });
  expect(host.snapshot.refresh).toHaveBeenCalledTimes(1);
  host.replace({ ...host.snapshot, action: normalizeAffordance(fromJson(AffordanceSchema, { copy: "raw", refreshOnSuccess: true })),
    refresh: async () => { throw new Error("private refresh error"); } });
  expect(await host.dispatcher.activate()).toEqual({ status: "succeeded", refresh: "failed" });
  expect(host.effects.copy).toHaveBeenCalledTimes(2);
});
