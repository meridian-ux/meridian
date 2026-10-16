// In-process admission for React's JSON host seam. Authored bindings remain
// RpcCall/FieldBinding protos; this budget and its owned tree never serialize.
import type { FieldBinding, RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { PaginationMode, type Pagination } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";

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
  visit(depth: number, limit = DEPTH): void {
    if (depth > limit || --this.nodes < 0) reject();
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
  clone(value: unknown, depth = 0, ancestors = new Set<object>(), descriptor = false): unknown {
    // Proto oneof/message wrappers add structural levels that are not logical
    // form/request nesting. Descriptor identity has a separate bounded ceiling;
    // it must not reject a valid form below its existing 64-level semantic gate.
    this.visit(depth, descriptor ? 512 : DEPTH);
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
        for (let i = 0; i < value.length; i++) result.push(this.clone(own(value, String(i)), depth + 1, ancestors, descriptor));
        return result;
      }
      const result: Row = {};
      // JS key enumeration/proxy traps and the host's original allocation are
      // outside this work budget. No getters or toJSON callbacks are executed.
      for (const key of Object.keys(value)) {
        this.text(key);
        const child = own(value, key);
        // Generated protobuf messages permit explicitly unset optional fields.
        // Descriptor identity omits those just as JSON.stringify does; request
        // data still rejects undefined rather than silently losing raw values.
        if (descriptor && child === undefined) continue;
        Object.defineProperty(result, key, { value: this.clone(child, depth + 1, ancestors, descriptor), enumerable: true, writable: true, configurable: true });
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
  budget: Budget, depth: number, target: Row, form?: { values: Row; declared: ReadonlySet<string> }): void {
  for (const binding of bindings) {
    budget.visit(depth);
    const keys = budget.path(binding.requestField);
    let value: unknown;
    let owned = false;
    switch (binding.source.case) {
      case "nested": {
        const nested: Row = {};
        bindingsInto(binding.source.value.fields, selection, record, budget, depth + keys.length, nested, form);
        if (Object.keys(nested).length === 0) continue;
        value = nested;
        owned = true;
        break;
      }
      case "rowField": value = record ? fromRow(record, binding.source.value, budget) : undefined; break;
      case "literal": value = binding.source.value; break;
      case "formField":
        if (!form) continue;
        if (binding.source.value.length > DECLARATION) reject();
        budget.text(binding.source.value);
        value = form.declared.has(binding.source.value) ? own(form.values, binding.source.value) : undefined;
        break;
      case "selectionKey":
        if (binding.source.value.length > DECLARATION) reject();
        budget.text(binding.source.value);
        value = own(selection, binding.source.value);
        if (value !== undefined && typeof value !== "string") reject();
        if (value === "") continue;
        break;
      default: continue; // No invented signal or host context.
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
  return JSON.stringify(new Budget().clone(value, 0, new Set(), true));
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

export function boundedSelectionKey(call: RpcCall | undefined, selection: Record<string, string>): string {
  const budget = new Budget();
  const pairs: [string, string][] = [];
  function scan(fields: FieldBinding[], depth: number): void {
    for (const field of fields) {
      budget.visit(depth);
      if (field.source.case === "nested") scan(field.source.value.fields, depth + 1);
      if (field.source.case !== "selectionKey") continue;
      const name = field.source.value;
      if (name.length > DECLARATION) reject();
      budget.text(name);
      const value = own(selection, name) ?? "";
      if (typeof value !== "string") reject();
      budget.text(value as string);
      pairs.push([name, value as string]);
    }
  }
  try {
    scan(call?.bindings ?? [], 0);
    return pairs.length ? JSON.stringify(pairs) : "";
  } catch { return "!invalid-selection-dependencies"; }
}

export function hasSelectionSource(call: RpcCall | undefined): boolean {
  const key = boundedSelectionKey(call, {});
  return key !== ""; // Invalid declarations are not eligible for an SSR seed.
}

export type PageOptions = { page?: number; cursor?: string; pageSize?: number };

/** Bindings and paging share one budget and owned tree. Assigning page.limit
 * must not drop a sibling bound page.tenant through a shallow object spread. */
export function boundedPopulateRequest(call: RpcCall | undefined, selection: Record<string, string>, pagination?: Pagination, opts: PageOptions = {}): Row {
  const budget = new Budget();
  if (call && (!call.service || !call.method || call.service.length > DECLARATION || call.method.length > DECLARATION)) reject();
  const request: Row = {};
  bindingsInto(call?.bindings ?? [], selection, undefined, budget, 0, request);
  if (!pagination || ![PaginationMode.OFFSET, PaginationMode.CURSOR].includes(pagination.mode)) return request;
  const size = opts.pageSize ?? (pagination.pageSize > 0 ? pagination.pageSize : 20);
  if (!Number.isSafeInteger(size) || size <= 0) reject();
  function assign(path: string, value: unknown): void {
    if (!path) return;
    const keys = budget.path(path);
    put(request, keys, budget.clone(value, keys.length));
  }
  if (pagination.mode === PaginationMode.OFFSET) {
    const page = opts.page ?? 0;
    if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(page * size)) reject();
    assign(pagination.offsetRequestField, page * size);
  } else {
    // An invalid authored cursor path is invalid even on the first page, when
    // there is no token to assign yet. Never defer rejection until later pages.
    if (pagination.cursorRequestField) budget.path(pagination.cursorRequestField);
    if (opts.cursor) assign(pagination.cursorRequestField, opts.cursor);
  }
  assign(pagination.limitRequestField, size);
  return request;
}

export function bindingRequestJson(call: RpcCall | undefined, selection: Record<string, string>): string | undefined {
  try { return JSON.stringify(boundedPopulateRequest(call, selection)); }
  catch { return undefined; }
}

/** Mirrors RequestBuilder::build_submission: Form IDs are literal keys and
 * explicit bindings win; LRO inputs map request paths after explicit bindings.
 * Authored declarations have their own bounded preflight. All referenced value
 * copies and automatic assignments then consume ONE shared request budget. */
export function buildSubmissionRequest(call: RpcCall, fields: FormField[], values: Row,
  selection: Record<string, string>, kind: "form" | "lro", record?: Row): Row {
  if (!call.service || !call.method || call.service.length > DECLARATION || call.method.length > DECLARATION) reject();
  if (!values || typeof values !== "object" || Array.isArray(values)) reject();
  // Do not serialize declarations or let cyclic/huge authored trees reach the
  // recursive LRO path planner. Optional proto properties are not RPC values.
  new Budget().clone(fields, 0, new Set(), true);
  const budget = new Budget();
  const declared = new Set<string>();
  for (const field of fields) {
    budget.visit(0);
    const id = field.fieldId;
    if (!id || id.length > DECLARATION || unsafe(id) || declared.has(id)) reject();
    budget.text(id);
    declared.add(id);
  }
  const request: Row = {};
  bindingsInto(call.bindings, selection, record, budget, 0, request, { values, declared });
  function fieldValue(source: unknown, id: string): unknown {
    if (!source || typeof source !== "object" || !Object.hasOwn(source, id)) return null;
    const value = own(source, id);
    if (value === undefined) reject();
    return value;
  }
  if (kind === "form") {
    for (const field of fields) {
      if (Object.hasOwn(request, field.fieldId)) continue;
      const value = budget.clone(fieldValue(values, field.fieldId), 1);
      // IDs such as a.b remain literal keys; request_field is LRO-only.
      Object.defineProperty(request, field.fieldId, { value, enumerable: true, writable: true, configurable: true });
    }
  } else {
    function merge(inputs: FormField[], source: unknown, prefix: string[], depth: number): void {
      const ids = new Set<string>();
      for (const field of inputs) {
        budget.visit(depth);
        if (!field.fieldId || field.fieldId.length > DECLARATION || unsafe(field.fieldId) || ids.has(field.fieldId)) reject();
        budget.text(field.fieldId);
        ids.add(field.fieldId);
        const segment = budget.path(field.requestField || field.fieldId);
        if (prefix.length + segment.length > DEPTH) reject();
        const keys = [...prefix, ...segment];
        const value = fieldValue(source, field.fieldId);
        if (field.kind.case === "nested") merge(field.kind.value.fields, value, keys, depth + 1);
        else put(request, keys, budget.clone(value, keys.length));
      }
    }
    merge(fields, values, [], 0);
  }
  return request;
}
