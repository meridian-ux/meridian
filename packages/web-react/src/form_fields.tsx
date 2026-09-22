// form_fields.tsx — kit-agnostic shared renderer for meridian.ui.v1 FormField,
// NestedForm and RepeatedField. Both reference kits (htmlKit + shadcnKit) delegate
// here, differing only in the FormFieldClasses table — the same guarantee used by
// content_shapes.tsx.
//
// RepeatedFieldControl is the stateful widget: it manages the ordered list of rows
// and exposes Add / Remove / Move-up / Move-down controls (mode === EDIT only).
// Reorder is up/down buttons here; a drag-capable kit can replace the controls by
// rendering its own row-order UI at the same slot.
//
// Serialization convention (proto3-JSON):
//   • A scalar array field uses names like  `tags[0]`, `tags[1]`, …
//   • A nested array field uses names like  `groups[0].label`, `groups[0].kinds[0]`, …
//   The hidden <input> at the end of each RepeatedFieldControl carries the full
//   JSON-encoded current value at `namePath` so standard FormData round-trips work.

import { createContext, useContext, useEffect, useId, useState } from "react";
import { useRpcInvoker } from "./provider.js";
import { formatByDisplay } from "@savvifi/meridian-schemas/uiview";
import type { ReactNode } from "react";

import type {
  FormField,
  EnumSelection,
  KeyValueMapField,
  NestedForm,
  RepeatedField,
} from "@savvifi/meridian-proto-ts/proto/form_pb.js";

export const FormInitialValues = createContext<Record<string, unknown>>({});
// Runtime-only validation registry; loaded option tokens are never taken from DOM markup.
export const FormEnumValues = createContext<Map<string, readonly string[]> | undefined>(undefined);

// Native option styling is platform-dependent; expose semantic roles without literal colors.
const enumTones: Readonly<Partial<Record<number, string>>> = { 1: "neutral", 2: "info", 3: "success", 4: "warning", 5: "danger", 6: "accent" };

function EnumInput({ spec, name, raw, className }: { spec: EnumSelection; name: string; raw: unknown; className: string }) {
  const invoker = useRpcInvoker();
  const registry = useContext(FormEnumValues);
  const id = useId();
  const source = spec.optionsSource;
  const [result, setResult] = useState<{ options: { value: string; label: string }[]; error?: string }>();
  const [chosen, setChosen] = useState(String(raw));
  useEffect(() => {
    if (!source) return;
    let active = true;
    setResult(undefined);
    const path = (value: unknown, key: string): unknown => key.split(".").reduce<unknown>((item, part) =>
      item && typeof item === "object" && Object.hasOwn(item, part) ? (item as Record<string, unknown>)[part] : undefined, value);
    void Promise.resolve().then(() => {
      if (!source.service || !source.method) throw new Error("Invalid options source.");
      return invoker.invoke(source.service, source.method, {});
    }).then(response => {
      const rows = path(response, source.optionsField);
      if (!Array.isArray(rows)) throw new Error("Invalid options response.");
      const options = rows.map(row => {
        const value = path(row, source.valueField);
        if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid option value.");
        const label = source.labelField ? path(row, source.labelField) : value;
        return { value: String(value), label: String(label ?? value) };
      });
      if (active) setResult({ options });
    }).catch(reason => { if (active) setResult({ options: [], error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { active = false; };
  }, [source, invoker]);
  const options: { value: string; label: string; tone?: number }[] = source ? result?.options ?? [] : spec.options.length
    ? spec.options.map(option => ({ value: option.value, label: option.label || option.value, tone: option.tone }))
    : spec.allowedValues.map(value => ({ value, label: value }));
  const tokens = options.map(option => option.value);
  const tokenKey = JSON.stringify(tokens);
  useEffect(() => {
    registry?.set(name, tokens);
    return () => { if (registry?.get(name) === tokens) registry.delete(name); };
  }, [registry, name, tokenKey]);
  const pending = Boolean(source && !result);
  const message = pending ? "Loading options…" : result?.error ? `Could not load options: ${result.error}` : options.length === 0 ? "No options available." : "";
  const value = tokens.includes(chosen) ? chosen : tokens[0] ?? "";
  return <><select name={name} className={className} value={value} disabled={pending || options.length === 0}
    data-value-tone={enumTones[options.find(option => option.value === value)?.tone ?? 0]}
    aria-busy={pending || undefined} aria-describedby={message ? id : undefined} onChange={event => setChosen(event.target.value)}>
    {options.length === 0 && <option value="">{pending ? "Loading…" : "No options"}</option>}
    {options.map((option, index) => <option key={`${option.value}:${index}`} value={option.value} data-value-tone={enumTones[option.tone ?? 0]}>{option.label}</option>)}
  </select>{message && <span id={id} role={result?.error ? "alert" : "status"}>{message}</span>}</>;
}
function useInitialValue(name: string): unknown {
  const values = useContext(FormInitialValues);
  if (Object.hasOwn(values, name)) return values[name];
  return name.replace(/\[(\d+)\]/g, ".$1").split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object" && Object.hasOwn(value, key)
      ? (value as Record<string, unknown>)[key] : undefined, values);
}

// ── Class table ────────────────────────────────────────────────────────────────

/** The class vocabulary for form-field rendering; one constant per kit. */
export interface FormFieldClasses {
  field: string;
  fieldLabel: string;
  fieldDesc: string;
  fieldInput: string;
  fieldSelect: string;
  fieldValue: string;
  fieldCheck: string;
  nested: string;
  repeated: string;
  repeatedList: string;
  repeatedRow: string;
  repeatedRowBody: string;
  repeatedRowControls: string;
  moveUpBtn: string;
  moveDownBtn: string;
  removeBtn: string;
  addBtn: string;
}

export const HTML_FORM_CLASSES: FormFieldClasses = {
  field: "mer-field",
  fieldLabel: "mer-field-label",
  fieldDesc: "mer-field-desc",
  fieldInput: "mer-field-input",
  fieldSelect: "mer-field-select",
  fieldValue: "mer-field-value",
  fieldCheck: "mer-field-check",
  nested: "mer-nested",
  repeated: "mer-repeated",
  repeatedList: "mer-repeated-list",
  repeatedRow: "mer-repeated-row",
  repeatedRowBody: "mer-repeated-row-body",
  repeatedRowControls: "mer-repeated-controls",
  moveUpBtn: "mer-repeated-move-up",
  moveDownBtn: "mer-repeated-move-down",
  removeBtn: "mer-repeated-remove",
  addBtn: "mer-repeated-add",
};

export const SHADCN_FORM_CLASSES: FormFieldClasses = {
  field: "grid gap-2",
  fieldLabel: "text-sm font-medium leading-none",
  fieldDesc: "text-xs text-muted-foreground",
  fieldInput: "flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm",
  fieldSelect: "flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm",
  fieldValue: "text-sm text-muted-foreground",
  fieldCheck: "h-4 w-4 rounded border",
  nested: "pl-4 border-l grid gap-3",
  repeated: "grid gap-3",
  repeatedList: "grid gap-2",
  repeatedRow: "flex items-start gap-2 rounded-md border p-2",
  repeatedRowBody: "flex-1 grid gap-2",
  repeatedRowControls: "flex flex-col gap-1 shrink-0",
  moveUpBtn: "inline-flex h-6 items-center justify-center rounded-sm border px-1.5 text-xs",
  moveDownBtn: "inline-flex h-6 items-center justify-center rounded-sm border px-1.5 text-xs",
  removeBtn: "inline-flex h-6 items-center justify-center rounded-sm border px-1.5 text-xs",
  addBtn: "inline-flex h-8 items-center justify-center rounded-md border border-dashed px-3 text-sm",
};

// ── Scalar widget ──────────────────────────────────────────────────────────────

/** Renders the leaf input widget for a scalar FormField (or a read-only span). */
function ScalarInput({
  c,
  field,
  mode,
  name,
}: {
  c: FormFieldClasses;
  field: FormField;
  mode: number;
  name: string;
}): ReactNode {
  const initial = useInitialValue(name);
  const fallback = field.kind.value && "defaultValue" in field.kind.value ? field.kind.value.defaultValue : "";
  const raw = initial ?? fallback;
  if (mode !== 2) {
    const shown = field.display ? formatByDisplay(raw, field.display) : { text: String(raw) };
    return <span className={c.fieldValue} data-field={name}>{field.kind.case === "masked" ? "••••••" : shown.text}</span>;
  }
  const kind = field.kind;
  if (kind.case === "boolean") {
    return (
      <input
        type="checkbox"
        className={c.fieldCheck}
        name={name}
        defaultChecked={Boolean(raw)}
      />
    );
  }
  if (kind.case === "integer") {
    return (
      <input
        type="number"
        className={c.fieldInput}
        name={name}
        min={kind.value.min !== 0 ? kind.value.min : undefined}
        max={kind.value.max !== 0 ? kind.value.max : undefined}
        step={kind.value.step !== 0 ? kind.value.step : 1}
        defaultValue={String(raw)}
      />
    );
  }
  if (kind.case === "number") {
    return (
      <input
        type="number"
        className={c.fieldInput}
        name={name}
        min={kind.value.min !== 0 ? kind.value.min : undefined}
        max={kind.value.max !== 0 ? kind.value.max : undefined}
        step={kind.value.step !== 0 ? kind.value.step : undefined}
        defaultValue={String(raw)}
      />
    );
  }
  if (kind.case === "enumSelection") {
    return <EnumInput spec={kind.value} name={name} raw={raw} className={c.fieldSelect} />;
  }
  // text, masked, or unset
  return (
    <input
      type={kind.case === "masked" ? "password" : "text"}
      className={c.fieldInput}
      name={name}
      defaultValue={String(raw)}
    />
  );
}

// ── NestedFormFields ───────────────────────────────────────────────────────────

/** Renders a NestedForm's fields inside a nested container (recursive). */
export function NestedFormFields({
  c,
  nested,
  mode,
  pathPrefix,
}: {
  c: FormFieldClasses;
  nested: NestedForm;
  mode: number;
  pathPrefix: string;
}): ReactNode {
  return (
    <div className={c.nested}>
      {nested.fields.map((f) => (
        <FormFieldRow
          key={f.fieldId}
          c={c}
          field={f}
          mode={mode}
          pathPrefix={pathPrefix}
        />
      ))}
    </div>
  );
}

// ── FormFieldRow ───────────────────────────────────────────────────────────────

/**
 * Renders a single FormField (any kind: scalar / nested / repeated).
 * `pathPrefix` is the dot-separated parent path; `field.requestField` is appended
 * to build the leaf name attribute (e.g. `groups[0].label`).
 */
export function FormFieldRow({
  c,
  field,
  mode,
  pathPrefix,
}: {
  c: FormFieldClasses;
  field: FormField;
  mode: number;
  /** Dot-separated ancestor path, e.g. "groups[0]". Absent at the top level. */
  pathPrefix?: string;
}): ReactNode {
  const seg = field.requestField || field.fieldId;
  const namePath = pathPrefix ? `${pathPrefix}.${seg}` : seg;

  const kind = field.kind;

  if (kind.case === "nested") {
    return (
      <div className={c.field}>
        {field.label && <span className={c.fieldLabel}>{field.label}</span>}
        {field.description && (
          <span className={c.fieldDesc}>{field.description}</span>
        )}
        <NestedFormFields
          c={c}
          nested={kind.value}
          mode={mode}
          pathPrefix={namePath}
        />
      </div>
    );
  }

  if (kind.case === "repeated") {
    return (
      <div className={c.field}>
        {field.label && <span className={c.fieldLabel}>{field.label}</span>}
        {field.description && (
          <span className={c.fieldDesc}>{field.description}</span>
        )}
        <RepeatedFieldControl
          c={c}
          spec={kind.value}
          mode={mode}
          namePath={namePath}
        />
      </div>
    );
  }

  if (kind.case === "keyValueMap") {
    return (
      <div className={c.field}>
        {field.label && <span className={c.fieldLabel}>{field.label}</span>}
        {field.description && (
          <span className={c.fieldDesc}>{field.description}</span>
        )}
        <KeyValueMapControl
          c={c}
          spec={kind.value}
          mode={mode}
          namePath={namePath}
        />
      </div>
    );
  }

  // Scalar field
  return (
    <div className={c.field}>
      <label>
        {field.label && <span className={c.fieldLabel}>{field.label}</span>}
        {field.description && (
          <span className={c.fieldDesc}>{field.description}</span>
        )}
        <ScalarInput c={c} field={field} mode={mode} name={namePath} />
      </label>
    </div>
  );
}

// ── KeyValueMapFieldControl ───────────────────────────────────────────────────

interface KeyValueRow {
  id: number;
  key: string;
  value: string;
}

/**
 * Stateful string-map editor. The visible controls use indexed names so the
 * submitted form remains inspectable, while the hidden input carries the
 * canonical object value expected by RPC request builders.
 */
export function KeyValueMapControl({
  c,
  spec,
  mode,
  namePath,
}: {
  c: FormFieldClasses;
  spec: KeyValueMapField;
  mode: number;
  namePath: string;
}): ReactNode {
  const initial = useInitialValue(namePath);
  const entries = initial && typeof initial === "object" && !Array.isArray(initial) ? Object.entries(initial) : [];
  const [rows, setRows] = useState<KeyValueRow[]>(() => entries.map(([key, value], id) => ({ id, key, value: String(value) })));
  const [nextId, setNextId] = useState(entries.length);
  const maxItems = spec.maxItems ?? 0;
  const isEdit = mode === 2;
  // Keep one pending blank row at a time: duplicate blank keys would collapse
  // when the canonical object is serialized for submission.
  const canAdd =
    !rows.some((row) => row.key === "") &&
    (maxItems === 0 || rows.length < maxItems);
  const mapValue = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  function addRow() {
    if (!canAdd) return;
    setRows((prev) => [...prev, { id: nextId, key: "", value: "" }]);
    setNextId((value) => value + 1);
  }

  function updateRow(id: number, patch: Partial<Omit<KeyValueRow, "id">>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }

  const keyLabel = spec.keyLabel || "Key";
  const valueLabel = spec.valueLabel || "Value";
  const addLabel = spec.addLabel || "Add entry";

  return (
    <div
      className={c.repeated}
      data-key-value-map
      data-max={maxItems || undefined}
    >
      <ol className={c.repeatedList}>
        {rows.map((row, index) => (
          <li key={row.id} className={c.repeatedRow}>
            <div className={c.repeatedRowBody}>
              <label>
                <span className={c.fieldLabel}>{keyLabel}</span>
                <input
                  className={c.fieldInput}
                  name={`${namePath}[${index}].key`}
                  value={row.key}
                  readOnly={!isEdit}
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                />
              </label>
              <label>
                <span className={c.fieldLabel}>{valueLabel}</span>
                <input
                  className={c.fieldInput}
                  name={`${namePath}[${index}].value`}
                  value={row.value}
                  readOnly={!isEdit}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                />
              </label>
            </div>
            {isEdit && (
              <div className={c.repeatedRowControls}>
                <button
                  type="button"
                  className={c.removeBtn}
                  aria-label="Remove entry"
                  onClick={() => removeRow(row.id)}
                >
                  ×
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <input type="hidden" name={namePath} value={JSON.stringify(mapValue)} />
      {isEdit && (
        <button
          type="button"
          className={c.addBtn}
          data-key-value-map-add
          disabled={!canAdd}
          onClick={addRow}
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}

// ── RepeatedFieldControl ───────────────────────────────────────────────────────

/** Stable identity for each list row — survives add/remove/reorder. */
interface RowSlot {
  id: number;
}

/**
 * Stateful repeated-field widget: ordered list of rows with Add / Remove /
 * Move-up / Move-down controls. Controls are hidden in read-only mode
 * (mode !== EDIT). Enforces min_items / max_items.
 *
 * Serialization: each row's inputs carry bracket-indexed names
 * (`namePath[i]` for scalar, `namePath[i].subField` for nested). A
 * `<input type="hidden">` at the end of the list carries the JSON-encoded
 * current row count so a FormData collector can detect empty arrays.
 */
export function RepeatedFieldControl({
  c,
  spec,
  mode,
  namePath,
}: {
  c: FormFieldClasses;
  spec: RepeatedField;
  mode: number;
  namePath: string;
}): ReactNode {
  const initialValues = useContext(FormInitialValues);
  const minItems = spec.minItems ?? 0;
  const initial = useInitialValue(namePath);
  const initialCount = Array.isArray(initial) ? initial.length : minItems;
  const maxItems = spec.maxItems ?? 0; // 0 = unlimited

  const [rows, setRows] = useState<RowSlot[]>(() =>
    Array.from({ length: initialCount }, (_, i) => ({ id: i })),
  );
  const [nextId, setNextId] = useState(initialCount);

  const canAdd = maxItems === 0 || rows.length < maxItems;
  const canRemove = rows.length > minItems;

  function addRow() {
    if (!canAdd) return;
    const id = nextId;
    setRows((prev) => [...prev, { id }]);
    setNextId((n) => n + 1);
  }

  function removeRow(idx: number) {
    if (!canRemove) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveRow(from: number, to: number) {
    if (to < 0 || to >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  const element = spec.element;
  const addLabel = spec.addLabel || "Add";
  const isEdit = mode === 2;

  function rowValues(id: number, index: number): Record<string, unknown> {
    const source = `${namePath}[${id}]`;
    const destination = `${namePath}[${index}]`;
    return Object.fromEntries(Object.entries(initialValues).flatMap(([key, value]) => {
      if (key === namePath) return [[key, undefined]];
      if (key === source || key.startsWith(`${source}.`) || key.startsWith(`${source}[`))
        return [[destination + key.slice(source.length), value]];
      return key.startsWith(`${namePath}[`) ? [] : [[key, value]];
    }));
  }

  return (
    <div className={c.repeated} data-min={minItems || undefined} data-max={maxItems || undefined}>
      <ol className={c.repeatedList}>
        {rows.map((row, idx) => (
          <li key={row.id} className={c.repeatedRow}>
            <div className={c.repeatedRowBody}>
              <FormInitialValues.Provider value={rowValues(row.id, idx)}>
              {element.case === "object" ? (
                <NestedFormFields
                  c={c}
                  nested={element.value}
                  mode={mode}
                  pathPrefix={`${namePath}[${idx}]`}
                />
              ) : element.case === "scalar" ? (
                <ScalarInput
                  c={c}
                  field={element.value}
                  mode={mode}
                  name={`${namePath}[${idx}]`}
                />
              ) : null}
              </FormInitialValues.Provider>
            </div>
            {isEdit && (
              <div className={c.repeatedRowControls}>
                <button
                  type="button"
                  className={c.moveUpBtn}
                  onClick={() => moveRow(idx, idx - 1)}
                  disabled={idx === 0}
                  aria-label="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={c.moveDownBtn}
                  onClick={() => moveRow(idx, idx + 1)}
                  disabled={idx === rows.length - 1}
                  aria-label="Move down"
                >
                  ▼
                </button>
                <button
                  type="button"
                  className={c.removeBtn}
                  onClick={() => removeRow(idx)}
                  disabled={!canRemove}
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {/*
        Hidden input carries the serialized row count at namePath so FormData
        collectors can detect an empty array (rows.length === 0 → omit the field,
        matching the "Empty list → omit the field" requirement).
      */}
      {rows.length > 0 && (
        <input
          type="hidden"
          name={`${namePath}.__count`}
          value={rows.length}
        />
      )}
      {isEdit && (
        <button
          type="button"
          className={c.addBtn}
          onClick={addRow}
          disabled={!canAdd}
          aria-label={addLabel}
          data-repeated-add={namePath}
        >
          {addLabel}
        </button>
      )}
    </div>
  );
}
