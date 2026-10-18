import { create, fromJson, type JsonObject } from "@bufbuild/protobuf";
import { expect, it, vi } from "vitest";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { ActionSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { RowActionSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { normalizeAffordance, normalizeLegacyAction, normalizeLegacyRowAction } from "./action_normalization.js";
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

function expectNoEffects(effects: ReturnType<typeof setup>["effects"]) {
  const { rpc: transport, ...rest } = effects;
  expect(transport.invoke).not.toHaveBeenCalled();
  for (const effect of Object.values(rest)) expect(effect).not.toHaveBeenCalled();
}

function expectOnceWith(callback: unknown, ...args: unknown[]) {
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith(...args);
}

it("constructing and inspecting a dispatcher performs no resolution, policy, confirmation, or IO", () => {
  const host = setup();
  const resolveSemantic = vi.fn();
  host.replace({ ...host.snapshot, action: normalizeLegacyAction(create(ActionSchema, { id: "semantic" })), resolveSemantic });
  expect(host.dispatcher.pending).toBe(false);
  expect(resolveSemantic).not.toHaveBeenCalled();
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

it.each([false, true])("legacy row id fallback is adapter-owned and optional (%s)", async legacyRowIdFallback => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeLegacyRowAction(create(RowActionSchema, {
    rpc: { service: "raw.Service", method: "Get" },
  })), context: { ...context(), selectedRow: { id: 0 } }, legacyRowIdFallback });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", legacyRowIdFallback ? { id: 0 } : {}, expect.any(AbortSignal));
});

it("a compatibility hint cannot add id to canonical intent or replace authored bindings", async () => {
  const host = setup({ rpc: { service: "raw.Service", method: "Get" } });
  host.replace({ ...host.snapshot, context: { ...context(), selectedRow: { id: 0 } }, legacyRowIdFallback: true });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", {}, expect.any(AbortSignal));
  host.effects.rpc.invoke.mockClear();
  host.replace({ ...host.snapshot, action: normalizeLegacyRowAction(create(RowActionSchema, {
    rpc: { service: "raw.Service", method: "Get", bindings: [{ requestField: "authored", source: { case: "literal", value: "raw" } }] },
  })) });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", { authored: "raw" }, expect.any(AbortSignal));
});

it("legacy id fallback rejects accessors without evaluating them", async () => {
  const host = setup();
  const get = vi.fn(() => "private");
  host.replace({ ...host.snapshot, action: normalizeLegacyRowAction(create(RowActionSchema, {
    rpc: { service: "raw.Service", method: "Get" },
  })), context: { ...context(), selectedRow: Object.defineProperty({}, "id", { enumerable: true, get }) }, legacyRowIdFallback: true });
  expect(await host.dispatcher.activate()).toEqual({ status: "failed" });
  expect(get).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("typed semantic resolution is authoritative and never acquires a legacy RPC id default", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeLegacyAction(create(ActionSchema, { id: "resolve-row" })),
    context: { ...context(), selectedRow: { id: 0 } }, legacyRowIdFallback: true,
    resolveSemantic: () => ({ affordance: fromJson(AffordanceSchema, { rpc: { service: "raw.Service", method: "Get" } }) }),
  });
  expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
  expectOnceWith(host.effects.rpc.invoke, "raw.Service", "Get", {}, expect.any(AbortSignal));
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

it("no-call legacy IDs require a pure resolver and retain exact row/header subject context", async () => {
  for (const subject of [{ entityType: "row", entityId: 0 }, { entityType: "header", entityId: "e\u0301" }]) {
    const host = setup();
    const legacy = create(ActionSchema, { id: "https://not-a-destination.test", label: "Confirm" });
    const confirm = vi.fn(async () => true);
    const resolved = fromJson(AffordanceSchema, { navigate: { route: "/form/subject" } });
    const resolveSemantic = vi.fn(() => ({ affordance: resolved, confirm }));
    host.replace({ ...host.snapshot, action: normalizeLegacyAction(legacy), subject, resolveSemantic });
    expect(await host.dispatcher.activate()).toMatchObject({ status: "succeeded" });
    expectOnceWith(resolveSemantic, legacy, host.snapshot.context, subject);
    expectOnceWith(confirm, host.snapshot.context, expect.any(AbortSignal));
    expectOnceWith(host.effects.navigate, resolved.invoke.value, host.snapshot.context, expect.any(AbortSignal));
    expect(host.effects.rpc.invoke).not.toHaveBeenCalled();
  }
});

it.each([false, true])("confirmation %s is consent only; it never grants mutation permission", async consent => {
  const host = setup(rpc);
  const confirm = vi.fn(async () => consent);
  host.replace({ ...host.snapshot, action: normalizeLegacyAction(create(ActionSchema, { id: "confirm-delete" })),
    resolveSemantic: () => ({ affordance: fromJson(AffordanceSchema, rpc), confirm }), admission: undefined });
  expect(await host.dispatcher.activate()).toEqual(consent ? { status: "denied", reason: "mutation-policy" } : { status: "cancelled" });
  expectNoEffects(host.effects);
});

it("missing/unresolved semantic actions visibly deny instead of treating the ID as a URI", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeLegacyAction(create(ActionSchema, { id: "/not-a-route" })) });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-resolver" });
  host.replace({ ...host.snapshot, resolveSemantic: () => undefined });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "unresolved-action" });
  expectNoEffects(host.effects);
});

it("an empty legacy semantic ID cannot be resolved into an executable default", async () => {
  const host = setup();
  const resolveSemantic = vi.fn(() => ({ affordance: fromJson(AffordanceSchema, { copy: "must-not-run" }) }));
  host.replace({ ...host.snapshot, action: normalizeLegacyAction(create(ActionSchema)), resolveSemantic });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "missing-target" });
  expect(resolveSemantic).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("canonical denial never runs an available legacy resolver", async () => {
  const host = setup({ command: "denied" });
  const resolveSemantic = vi.fn();
  host.replace({ ...host.snapshot, resolveSemantic, admit: () => false });
  expect(await host.dispatcher.activate()).toEqual({ status: "denied", reason: "target-policy" });
  expect(resolveSemantic).not.toHaveBeenCalled();
  expectNoEffects(host.effects);
});

it("scope changes during confirmation stop execution; retry resolves the new current subject", async () => {
  const host = setup();
  const consent = deferred<boolean>();
  const action = normalizeLegacyAction(create(ActionSchema, { id: "confirm" }));
  const resolveSemantic = vi.fn(() => ({ affordance: fromJson(AffordanceSchema, { copy: "first" }), confirm: () => consent.promise }));
  host.replace({ ...host.snapshot, action, resolveSemantic });
  const first = host.dispatcher.activate();
  expect(host.dispatcher.pending).toBe(true);
  expect(await host.dispatcher.activate()).toEqual({ status: "busy" });
  host.replace({ ...host.snapshot, subject: { entityId: "new" }, resolveSemantic: () => ({ affordance: fromJson(AffordanceSchema, { copy: "new" }) }) });
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

it("successful legacy rows refresh; canonical false suppresses refresh; refresh failure does not replay IO", async () => {
  const host = setup();
  host.replace({ ...host.snapshot, action: normalizeLegacyRowAction(create(RowActionSchema, {
    rpc: { service: "raw.Service", method: "Get" }, refreshOnSuccess: false,
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
