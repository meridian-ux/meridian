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

import { useState } from "react";
import type { ReactNode } from "react";

import type { FormField, NestedForm, RepeatedField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";

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
  if (mode !== 2) {
    return <span className={c.fieldValue} data-field={name} />;
  }
  const kind = field.kind;
  if (kind.case === "boolean") {
    return (
      <input
        type="checkbox"
        className={c.fieldCheck}
        name={name}
        defaultChecked={kind.value.defaultValue}
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
        defaultValue={kind.value.defaultValue}
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
        defaultValue={kind.value.defaultValue}
      />
    );
  }
  if (kind.case === "enumSelection") {
    return (
      <select
        className={c.fieldSelect}
        name={name}
        defaultValue={kind.value.defaultValue}
      >
        {kind.value.allowedValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  // text, masked, or unset
  const defVal =
    kind.case === "text" || kind.case === "masked"
      ? kind.value.defaultValue
      : "";
  return (
    <input
      type={kind.case === "masked" ? "password" : "text"}
      className={c.fieldInput}
      name={name}
      defaultValue={defVal !== "" ? defVal : undefined}
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
  const minItems = spec.minItems ?? 0;
  const maxItems = spec.maxItems ?? 0; // 0 = unlimited

  const [rows, setRows] = useState<RowSlot[]>(() =>
    Array.from({ length: minItems }, (_, i) => ({ id: i })),
  );
  const [nextId, setNextId] = useState(minItems);

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

  return (
    <div className={c.repeated} data-min={minItems || undefined} data-max={maxItems || undefined}>
      <ol className={c.repeatedList}>
        {rows.map((row, idx) => (
          <li key={row.id} className={c.repeatedRow}>
            <div className={c.repeatedRowBody}>
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
