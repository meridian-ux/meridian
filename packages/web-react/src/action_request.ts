// In-process admission for React's JSON host seam. Authored bindings remain
// RpcCall/FieldBinding protos; this budget and its owned tree never serialize.
import type { FieldBinding, RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";

type Row = Record<string, unknown>;
const WORK = 4 * 1024 * 1024;
const DEPTH = 64;
const NODES = 65_536;
const DECLARATION = 64 * 1024;
const unsafe = (key: string) => key === "__proto__" || key === "constructor" || key === "prototype";
const reject = (): never => { throw new Error("Request construction rejected."); };

function own(source: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(source, key);
  if (!property) return undefined;
  if (!("value" in property)) return reject();
  return property.value;
}

class Budget {
  private remaining = WORK;
  private nodes = NODES;
  reserve(work: number): void {
    if (!Number.isSafeInteger(work) || work < 0 || work > this.remaining) reject();
    this.remaining -= work;
  }
  visit(depth: number): void {
    if (depth > DEPTH || --this.nodes < 0) reject();
    this.reserve(64);
  }
  text(value: string): void {
    // Before copying/encoding: six bytes per UTF-16 unit bounds JSON escaping,
    // including control characters and unpaired surrogates.
    this.reserve(6 * value.length + 2);
  }
  path(path: string): string[] {
    if (path.length > DECLARATION) reject();
    this.text(path);
    const keys = path.split(".");
    if (keys.length > DEPTH || keys.some(key => !key || unsafe(key))) reject();
    this.reserve(64 * keys.length);
    return keys;
  }
  clone(value: unknown, depth = 0, ancestors = new Set<object>()): unknown {
    this.visit(depth);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { this.text(value); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) reject();
      this.reserve(32);
      return value;
    }
    if (!value || typeof value !== "object" || ancestors.has(value)) return reject();
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) reject();
    ancestors.add(value);
    try {
      if (array) {
        // Reject large sparse arrays before iteration/allocation. Holes and
        // accessors are not JSON values supplied by a decoded RPC response.
        this.reserve(value.length * 64);
        const result: unknown[] = [];
        for (let i = 0; i < value.length; i++) result.push(this.clone(own(value, String(i)), depth + 1, ancestors));
        return result;
      }
      const result: Row = {};
      // JS key enumeration/proxy traps and the host's original allocation are
      // outside this work budget. No getters or toJSON callbacks are executed.
      for (const key of Object.keys(value)) {
        this.text(key);
        Object.defineProperty(result, key, { value: this.clone(own(value, key), depth + 1, ancestors), enumerable: true, writable: true, configurable: true });
      }
      return result;
    } finally { ancestors.delete(value); }
  }
}

function put(target: Row, keys: string[], value: unknown): void {
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    const child = cursor[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) cursor[key] = {};
    cursor = cursor[key] as Row;
  }
  cursor[keys[keys.length - 1]] = value;
}

function fromRow(row: Row, path: string, budget: Budget): unknown {
  if (!path) return undefined;
  // Read paths can name prototype-looking *own data*. Only assignment paths
  // are forbidden from creating or traversing prototype machinery.
  if (path.length > DECLARATION) reject();
  budget.text(path);
  const keys = path.split(".");
  if (keys.length > DEPTH) reject();
  let value: unknown = row;
  for (const key of keys) value = value && typeof value === "object" ? own(value, key) : undefined;
  return value;
}

function bindingsInto(bindings: FieldBinding[], selection: Record<string, string>, record: Row | undefined,
  budget: Budget, depth: number, target: Row): void {
  for (const binding of bindings) {
    budget.visit(depth);
    const keys = budget.path(binding.requestField);
    let value: unknown;
    let owned = false;
    switch (binding.source.case) {
      case "nested": {
        const nested: Row = {};
        bindingsInto(binding.source.value.fields, selection, record, budget, depth + keys.length, nested);
        if (Object.keys(nested).length === 0) continue;
        value = nested;
        owned = true;
        break;
      }
      case "rowField": value = record ? fromRow(record, binding.source.value, budget) : undefined; break;
      case "literal": value = binding.source.value; break;
      case "selectionKey":
        if (binding.source.value.length > DECLARATION) reject();
        budget.text(binding.source.value);
        value = own(selection, binding.source.value);
        if (value === "") continue;
        break;
      default: continue; // No invented form, signal, or host context.
    }
    if (value === undefined || value === null) continue;
    put(target, keys, owned ? value : budget.clone(value, depth + keys.length));
  }
}

/** Whole-request failure, not a partial request or an empty-object fallback.
 * Each borrowed value is copied once under one cumulative budget; subsequent
 * overlapping assignments only mutate this invocation's owned tree. */
export function boundedActionRequest(call: RpcCall | undefined, selection: Record<string, string>, record?: Row, defaults: Row = {}): Row {
  const budget = new Budget();
  if (call && (call.service.length > DECLARATION || call.method.length > DECLARATION)) reject();
  for (const key of Object.keys(defaults)) if (key.length > DECLARATION || unsafe(key)) reject();
  const request = budget.clone(defaults) as Row;
  bindingsInto(call?.bindings ?? [], selection, record, budget, 0, request);
  return request;
}

/** Bounded, getter-free descriptor identity; never stringify an unchecked graph. */
export function boundedJson(value: unknown): string {
  return JSON.stringify(new Budget().clone(value));
}

export function actionRequestJson(call: RpcCall | undefined, selection: Record<string, string>, record?: Row, defaults?: Row): string | undefined {
  try {
    if (call && (!call.service || !call.method || call.service.length > DECLARATION || call.method.length > DECLARATION)) return undefined;
    return JSON.stringify(boundedActionRequest(call, selection, record, defaults));
  } catch { return undefined; }
}

/** Invalid or recursive declarations are never eligible for an unscoped SSR seed. */
export function hasDynamicBindings(bindings: FieldBinding[]): boolean {
  const budget = new Budget();
  function scan(fields: FieldBinding[], depth: number): boolean {
    for (const field of fields) {
      budget.visit(depth);
      if (field.source.case === "nested") { if (scan(field.source.value.fields, depth + 1)) return true; }
      else if (field.source.case !== "literal") return true;
    }
    return false;
  }
  try { return scan(bindings, 0); } catch { return true; }
}
