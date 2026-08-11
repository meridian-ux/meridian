// muiKit — a meridian ComponentKit that paints panels with MUI. One
// implementation of the ComponentKit interface exported by
// @savvifi/meridian-web-react, a peer of htmlKit / shadcnKit: the kit-agnostic
// PanelRenderer / ViewRenderer dispatch the descriptor shapes to these
// components, so the same ViewDescriptor renders here as MUI tables + forms
// (with CLIENT / OFFSET / CURSOR pagination) instead of plain HTML.
//
// The kit owns its components (MeridianTable / MeridianForm, lifted + generalized
// from a graph-backed host's a host's internal MUI component library patterns) — no a host's internal MUI component library dependency — so the MUI table +
// form patterns are reusable by any meridian host, not just a studio console.

import { useContext, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Alert, Box, Button, Chip, IconButton, Link, Menu, MenuItem, Stack } from "@mui/material";

import type {
  ActionBarProps,
  ComponentKit,
  ShapeProps,
} from "@savvifi/meridian-web-react";
import { formatByDisplay } from "./display_format.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { ValueDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { useDisplayNow } from "./use_display_now.js";
import {
  buildBindingRequest,
  MeridianRowActionsContext,
  MeridianViewContext,
  PaginationMode,
  useActionHandler,
  useHrefResolver,
  useMeridianSelection,
  usePagedRows,
} from "@savvifi/meridian-web-react";
import type { EnumSelection, FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { GalleryPanel } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import {
  FormMode,
  type DetailHeaderPanel,
  type FormPanel,
  type PanelDescriptor,
  type RecordCardPanel,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { PromptPanel } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import {
  ColumnFormat,
  type TableColumn,
  type TablePanel,
} from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { ActionPlacement, type Action } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { ActionPanel } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { CatalogPanel } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import type { ChoicePanel } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import type { ConnectFlowPanel } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import type { CopyValuePanel } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import type { GrammarPanel } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import type { SnippetPanel } from "@savvifi/meridian-proto-ts/proto/snippet_pb.js";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import type { StepsPanel } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";
import type { MediaPanel } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import {
  ActionView,
  CatalogView,
  ChoiceView,
  ConnectFlowView,
  CopyValueView,
  GrammarView,
  SnippetView,
  StatView,
  StepsView,
  MediaView,
} from "./components/content.js";
import { MeridianForm, type MeridianFormField } from "./components/form.js";
import { MeridianTable, type MeridianColumn, type MeridianRowAction } from "./components/table.js";
import { MeridianDetailHeader } from "./components/detail_header.js";
import { MeridianGallery } from "./components/gallery.js";
import { MeridianRecordCard } from "./components/record_card.js";

type Row = Record<string, unknown>;

// ── shared helpers ──────────────────────────────────────────────────────────

/** Follow a dotted `field_path` (e.g. "subject.claim.text") into a row/response. */
function getNested(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

/**
 * Format a cell value. A column's `value_display` WINS when set; `ColumnFormat` is
 * the fallback.
 *
 * That precedence is the whole point of the additive migration: ValueDisplay is the
 * shared spec a card field and a table cell both speak, and ColumnFormat is the
 * table's older six-case vocabulary for the same question. Preferring the new one
 * lets a producer move a single column without a coordinated rewrite, while every
 * column that has not moved renders byte-identically.
 *
 * `nowMs` threads through for a temporal column that asked to read relatively —
 * undefined before mount, which keeps SSR and hydration in agreement (see
 * use_display_now.ts).
 */
function formatCell(
  value: unknown,
  format: ColumnFormat,
  display?: ValueDisplay,
  nowMs?: number,
): ReactNode {
  if (display && display.type !== ValueType.UNSPECIFIED) {
    const shown = formatByDisplay(value, display, nowMs);
    return shown.title ? <span title={shown.title}>{shown.text}</span> : shown.text;
  }
  if (value === null || value === undefined) return "";
  switch (format) {
    case ColumnFormat.FLOAT_2DP:
      return typeof value === "number" ? value.toFixed(2) : String(value);
    case ColumnFormat.STRING_LIST:
      return Array.isArray(value) ? value.join(", ") : String(value);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/**
 * Fire an RpcCall through the invoker. Returns the in-flight promise (undefined
 * when there is no call) so a caller that needs to know the write LANDED can
 * await it — a composer clearing itself only once the post succeeds. Callers that
 * don't care simply ignore the return, exactly as before.
 */
function invoke(invoker: RpcInvoker, call: RpcCall | undefined, req: Row = {}): Promise<unknown> | undefined {
  return call ? invoker.invoke(call.service, call.method, req) : undefined;
}

// ── Table ───────────────────────────────────────────────────────────────────

/** Page-size options for the table's page-size selector (parity with DataTableView). */
const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** A status/enum column renders its value as a colored MUI Chip (like the old table). */
function isStatusColumn(col: TableColumn): boolean {
  return col.format === ColumnFormat.ENUM_NAME || /^(status|state)$/i.test(col.header.trim());
}

/** Map a status string to an MUI Chip color — best-effort by common vocabulary. */
function statusChipColor(value: string): "default" | "success" | "warning" | "error" | "info" {
  const v = value.toLowerCase();
  if (/(active|complete|approv|success|paid|done|resolved|enabled|live|ready)/.test(v)) return "success";
  if (/(pending|draft|open|in.?progress|review|waiting|processing|scheduled)/.test(v)) return "warning";
  if (/(error|fail|reject|cancel|declin|expired|disabled|inactive|blocked)/.test(v)) return "error";
  return "default";
}

/** Stable comparator over cell values (numeric-aware; nulls sort first). */
function compareCellValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function TableShape({ panel, invoker }: { panel: TablePanel; invoker: RpcInvoker }): ReactNode {
  // usePagedRows (meridian-web-react) is the kit-agnostic pagination brain:
  // CLIENT returns all fetched rows (we slice locally); OFFSET / CURSOR fetch one
  // page at a time via the invoker. MeridianTable just displays a page + a pager.
  const paged = usePagedRows(panel, invoker);
  const client = paged.mode === PaginationMode.CLIENT;
  const [clientPage, setClientPage] = useState(0);
  // Host-controlled column sort. CLIENT sorts the full fetched set (parity with the
  // old DataTableView); server modes sort the current page in place.
  const [sort, setSort] = useState<{ columnId?: string; direction: "asc" | "desc" }>({ direction: "asc" });
  useEffect(() => {
    setClientPage(0);
    setSort({ direction: "asc" });
  }, [panel]);

  // A ColumnLink cell renders its value as a host-resolved link (resolveHref);
  // target_kind empty ⇒ the view's own subject. Absent resolver ⇒ plain text.
  const resolveHref = useHrefResolver();
  // undefined until mounted, so a relative cell renders absolute in the SSR pass
  // and both sides of hydration agree — see use_display_now.ts.
  const nowMs = useDisplayNow();
  const { subjectKind } = useContext(MeridianViewContext);
  const onAction = useActionHandler();

  const columns = useMemo<MeridianColumn<Row>[]>(
    () =>
      panel.columns.map((col: TableColumn, index) => {
        const status = isStatusColumn(col);
        return {
          id: col.fieldPath || col.header || String(index),
          header: col.header,
          width: col.prefWidth || undefined,
          sortable: true,
          render: (row: Row) => {
            const raw = getNested(row, col.fieldPath);
            const text = formatCell(raw, col.format, col.valueDisplay, nowMs);
            // target_kind empty ⇒ the view's own subject (a self/detail link).
            const targetKind = col.link ? col.link.targetKind || subjectKind : undefined;
            if (targetKind && resolveHref && raw != null && raw !== "") {
              const href = resolveHref(targetKind, String(raw));
              if (href) return <Link href={href} underline="hover">{text}</Link>;
            }
            // Status/enum ⇒ a colored chip (matches the old studio status pills).
            if (status && raw != null && raw !== "") {
              const label = String(text);
              return <Chip label={label} size="small" variant="outlined" color={statusChipColor(label)} />;
            }
            return text;
          },
        };
      }),
    [panel.columns, resolveHref, subjectKind, nowMs],
  );

  // Resolve the sort column's field_path (columns are keyed by field_path||header).
  const sortFieldPath = useMemo(() => {
    if (!sort.columnId) return undefined;
    const col = panel.columns.find((c) => (c.fieldPath || c.header) === sort.columnId);
    return col?.fieldPath || undefined;
  }, [sort.columnId, panel.columns]);
  const sortRows = (input: Row[]): Row[] => {
    if (!sortFieldPath) return input;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...input].sort(
      (a, b) => compareCellValues(getNested(a, sortFieldPath), getNested(b, sortFieldPath)) * dir,
    );
  };
  const toggleSort = (columnId: string) =>
    setSort((s) =>
      s.columnId === columnId
        ? { columnId, direction: s.direction === "asc" ? "desc" : "asc" }
        : { columnId, direction: "asc" },
    );

  // Effective page size lives in usePagedRows now (the page-size selector calls
  // paged.setPageSize — CLIENT re-slices, CURSOR/OFFSET refetch at the new size).
  const pageSize = paged.pageSize;
  let rows: Row[];
  let page: number;
  let count: number;
  let onPageChange: (target: number) => void;
  if (client) {
    // CLIENT: sort + paginate the full fetched set locally.
    const sorted = sortRows(paged.rows);
    rows = sorted.slice(clientPage * pageSize, (clientPage + 1) * pageSize);
    page = clientPage;
    count = paged.rows.length;
    onPageChange = (target) => setClientPage(target);
  } else {
    // Server modes: paged.rows is already the current page (sort it in place). MUI
    // derives its "X–Y of Z" label + Back/Next from `count` — use the real total
    // whenever the op returns one (OFFSET, or CURSOR now that a graph-backed host's op computes
    // totalCount); otherwise synthesize from hasNext ("one more page exists").
    rows = sortRows(paged.rows);
    page = paged.page;
    count =
      paged.total !== undefined
        ? paged.total
        : paged.hasNext
          ? (paged.page + 1) * pageSize + 1
          : (paged.page + 1) * pageSize;
    onPageChange = (target) => (target > paged.page ? paged.goNext() : paged.goPrev());
  }

  // Clicking a row opens the entity — the host resolves `(actionId, subject, id)`
  // to the detail route (graph-backed rows carry `id`). Only when a subject + handler exist.
  const onRowClick =
    onAction && subjectKind
      ? (row: Row) => {
          const id = (row as { id?: unknown }).id;
          if (id != null) onAction("open", subjectKind, id as string | number);
        }
      : undefined;

  // "Showing X of Y" only when Y is a real total (CLIENT counts the fetched set;
  // OFFSET and CURSOR read the op's totalCount). Without a total, show just the
  // current count — never a synthesized "of Y" (which would read as a real total).
  const noun = panel.itemNoun || "items";
  const footer =
    rows.length === 0
      ? undefined
      : paged.total !== undefined
        ? `Showing ${rows.length} of ${paged.total} ${noun}`
        : `Showing ${rows.length} ${noun}`;

  // Row actions render INSIDE each row as a ⋮ overflow menu (matching the old
  // studio TableActionsView — not a bar above the table). Two sources merge:
  //  - TablePanel.actions (RowAction[]): fire the RpcCall against THIS row (host
  //    rows carry `id`, so `{ id: row.id }`).
  //  - View-level ROW-placement actions (MeridianRowActionsContext): an op action
  //    (with a `call`) invokes against the row; a host-resolved action (no call —
  //    edit/view_details → a route) routes to the host's onAction with the row id.
  const viewRowActions = useContext(MeridianRowActionsContext);
  const perRowActions = useMemo<MeridianRowAction<Row>[]>(() => {
    const result: MeridianRowAction<Row>[] = [];
    (panel.actions ?? []).forEach((action, index) => {
      result.push({
        id: `panel-action-${index}`,
        label: action.label,
        onClick: (row: Row) => {
          const id = (row as { id?: unknown }).id;
          if (action.rpc) {
            void invoker.invoke(action.rpc.service, action.rpc.method, id != null ? { id } : {});
          }
        },
      });
    });
    for (const action of viewRowActions) {
      result.push({
        id: action.id,
        label: action.label,
        onClick: (row: Row) => {
          const id = (row as { id?: unknown }).id;
          if (action.call) {
            void invoker.invoke(action.call.service, action.call.method, id != null ? { id } : {});
            return;
          }
          onAction?.(action.id, subjectKind, id as string | number | undefined);
        },
      });
    }
    return result;
  }, [panel.actions, viewRowActions, invoker, onAction, subjectKind]);

  return (
    <Box>
      {paged.error ? (
        <Alert severity="error" className="mer-table-error">
          Failed to load {panel.itemNoun || "items"}.
        </Alert>
      ) : (
        <MeridianTable
          columns={columns}
          rows={rows}
          loading={paged.loading}
          emptyMessage={panel.placeholder || `No ${panel.itemNoun || "items"}.`}
          getRowKey={(row) => String((row as { id?: unknown }).id ?? JSON.stringify(row))}
          pagination={{
            page,
            count,
            pageSize,
            onPageChange,
            // The page-size selector works in every mode now: usePagedRows.setPageSize
            // re-slices (CLIENT) or refetches at the new size (CURSOR/OFFSET).
            pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
            onPageSizeChange: (size) => {
              paged.setPageSize(size);
              setClientPage(0);
            },
          }}
          rowActions={perRowActions.length > 0 ? perRowActions : undefined}
          onRowClick={onRowClick}
          sort={{ columnId: sort.columnId, direction: sort.direction, onToggle: toggleSort }}
          footer={footer}
          size="medium"
        />
      )}
    </Box>
  );
}

// ── Forms (Form / Prompt / Lro all render a field form) ──────────────────────

// The form value model is a recursive tree: scalars at the leaves, a keyed object
// for a `nested` sub-form, and an ordered array for a `repeated` list. It is
// submitted verbatim as the RPC request body (nested → nested object, repeated →
// array under the parent field's key), so it mirrors the request message shape.
type FormValue = string | number | boolean | FormObject | FormValue[];
interface FormObject {
  [fieldId: string]: FormValue;
}

type SetAt = (path: (string | number)[], value: FormValue) => void;

/** The initial value for one field (recurses into nested / repeated). */
function initField(field: FormField): FormValue {
  switch (field.kind.case) {
    case "integer":
    case "number":
      return field.kind.value.defaultValue ?? 0;
    case "boolean":
      return field.kind.value.defaultValue ?? false;
    case "enumSelection":
    case "text":
    case "masked":
      return field.kind.value.defaultValue ?? "";
    case "nested":
      return initValues(field.kind.value.fields);
    case "repeated": {
      const { element, minItems } = field.kind.value;
      if (element.case === "scalar") {
        // Seed min_items scalar rows.
        return Array.from({ length: minItems }, () => initField(element.value));
      } else if (element.case === "object") {
        // Seed min_items object (NestedForm) rows.
        return Array.from({ length: minItems }, () => initValues(element.value.fields));
      }
      return [];
    }
    default:
      return "";
  }
}

function initValues(fields: FormField[]): FormObject {
  const values: FormObject = {};
  for (const field of fields) values[field.fieldId] = initField(field);
  return values;
}

/** Read the value at a path (string keys index objects, number keys index arrays). */
function valueAt(root: FormValue | undefined, path: readonly (string | number)[]): FormValue | undefined {
  return path.reduce<FormValue | undefined>((acc, key) => {
    if (acc == null) return undefined;
    if (typeof key === "number") return Array.isArray(acc) ? acc[key] : undefined;
    return typeof acc === "object" && !Array.isArray(acc) ? (acc as FormObject)[key] : undefined;
  }, root);
}

/** Immutably set the value at a path, cloning each node along the way. */
function updateAt(node: FormValue | undefined, path: readonly (string | number)[], value: FormValue): FormValue {
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const arr = Array.isArray(node) ? [...node] : [];
    arr[head] = rest.length === 0 ? value : updateAt(arr[head], rest, value);
    return arr;
  }
  const obj: FormObject =
    node && typeof node === "object" && !Array.isArray(node) ? { ...(node as FormObject) } : {};
  obj[head] = rest.length === 0 ? value : updateAt(obj[head], rest, value);
  return obj;
}

/** Build one field descriptor at `path` (its full path into the value tree). */
function buildField(
  field: FormField,
  values: FormObject,
  setAt: SetAt,
  disabled: boolean,
  path: (string | number)[],
): MeridianFormField {
  const base = {
    key: path.join("."),
    label: field.label,
    helperText: field.description || undefined,
    disabled,
  };
  const current = valueAt(values, path);
  switch (field.kind.case) {
    case "integer": {
      const spec = field.kind.value;
      return {
        ...base,
        type: "number",
        value: typeof current === "number" ? current : 0,
        min: spec.min || undefined,
        max: spec.max || undefined,
        step: spec.step || undefined,
        onChange: (value: number) => setAt(path, value),
      };
    }
    case "number": {
      const spec = field.kind.value;
      return {
        ...base,
        type: "decimal",
        value: typeof current === "number" ? current : 0,
        min: spec.min || undefined,
        max: spec.max || undefined,
        step: spec.step || undefined,
        onChange: (value: number) => setAt(path, value),
      };
    }
    case "boolean":
      return {
        ...base,
        type: "boolean",
        value: typeof current === "boolean" ? current : false,
        onChange: (value: boolean) => setAt(path, value),
      };
    case "enumSelection":
      return {
        ...base,
        type: "select",
        value: typeof current === "string" ? current : "",
        onChange: (value: string) => setAt(path, value),
        options: enumOptions(field.kind.value),
      };
    case "nested":
      return {
        ...base,
        type: "group",
        fields: buildFields(field.kind.value.fields, values, setAt, disabled, path),
      };
    case "repeated": {
      const spec = field.kind.value;
      const arr = Array.isArray(current) ? current : [];
      // Build the per-row field descriptors based on the element type.
      let items: MeridianFormField[];
      if (spec.element.case === "scalar") {
        // scalar: each row is one inner FormField (position-keyed, field_id ignored).
        const scalar = spec.element.value;
        items = arr.map((_, index) => buildField(scalar, values, setAt, disabled, [...path, index]));
      } else if (spec.element.case === "object") {
        // object: each row is an anonymous NestedForm rendered as a group.
        const nested = spec.element.value;
        items = arr.map((_, index) => ({
          key: [...path, index].join("."),
          label: "",
          type: "group" as const,
          disabled,
          fields: buildFields(nested.fields, values, setAt, disabled, [...path, index]),
        }));
      } else {
        items = [];
      }
      return {
        ...base,
        type: "list",
        items,
        addLabel: spec.addLabel || "Add",
        // max_items 0 = unbounded; min_items 0 = no minimum.
        canAdd: spec.element.case !== undefined && (spec.maxItems === 0 || arr.length < spec.maxItems),
        canRemove: arr.length > spec.minItems,
        onAdd: () => {
          if (spec.element.case === "scalar") setAt(path, [...arr, initField(spec.element.value)]);
          else if (spec.element.case === "object") setAt(path, [...arr, initValues(spec.element.value.fields)]);
        },
        onRemove: (index: number) => setAt(path, arr.filter((_, i) => i !== index)),
        onMoveUp: (index: number) => {
          if (index <= 0) return;
          const newArr = [...arr];
          const tmp = newArr[index - 1];
          newArr[index - 1] = newArr[index];
          newArr[index] = tmp;
          setAt(path, newArr);
        },
        onMoveDown: (index: number) => {
          if (index >= arr.length - 1) return;
          const newArr = [...arr];
          const tmp = newArr[index + 1];
          newArr[index + 1] = newArr[index];
          newArr[index] = tmp;
          setAt(path, newArr);
        },
      };
    }
    case "text":
    case "masked":
    default:
      return {
        ...base,
        type: "text",
        value: typeof current === "string" ? current : "",
        onChange: (value: string) => setAt(path, value),
      };
  }
}

/**
 * The options for an `EnumSelection`, honouring the precedence form.proto states.
 *
 * `allowed_values` carries the stored token ONLY, so an option drawn from it can
 * show nothing but its raw id. `options` (schemas 0.21.0) adds the producer's
 * localized label — the producer being the only party that knows the viewer's
 * locale — and a display tone.
 *
 * form.proto is explicit that "when both are set, `options` wins and
 * `allowed_values` is ignored, so a producer can populate both during a migration
 * without renderers double-listing". Reading `allowed_values` first would
 * therefore be wrong twice: it loses the labels AND it disagrees with the
 * contract during exactly the migration the field was designed to support.
 *
 * This shipped as a live bug: a producer sent `options`, this kit read only
 * `allowedValues`, and the dropdown rendered EMPTY with no error anywhere.
 */
export function enumOptions(sel: EnumSelection): Array<{ value: string; label: string }> {
  if (sel.options.length > 0) {
    // label is OPTIONAL and "falls back to `value` when empty" — a blank entry is
    // worse than a raw token, since it cannot be picked out of a list.
    return sel.options.map((o) => ({ value: o.value, label: o.label || o.value }));
  }
  return sel.allowedValues.map((value) => ({ value, label: value }));
}

function buildFields(
  fields: FormField[],
  values: FormObject,
  setAt: SetAt,
  disabled: boolean,
  prefix: (string | number)[] = [],
): MeridianFormField[] {
  return fields.map((field) => buildField(field, values, setAt, disabled, [...prefix, field.fieldId]));
}

function FieldForm({
  fields,
  disabled,
  description,
  submitLabel,
  submitDisabled,
  onSubmit,
  resetOnSubmit,
}: {
  fields: FormField[];
  disabled: boolean;
  description?: string;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit?: (values: FormObject) => void | Promise<unknown>;
  /** Clear back to the initial values once a submit RESOLVES. For a form that
   *  CREATES (a comment composer, a quick-create dialog), the values are one
   *  submission, and leaving them behind reads as "that didn't go through" — the
   *  text you just posted is still sitting in the box beside its own new entry.
   *  Off by default: an EDIT form over an existing record must keep showing it. */
  resetOnSubmit?: boolean;
}): ReactNode {
  const [values, setValues] = useState<FormObject>(() => initValues(fields));
  const setAt: SetAt = (path, value) =>
    setValues((prev) => updateAt(prev, path, value) as FormObject);
  // Reset only on RESOLVE, never optimistically: clearing first and failing after
  // destroys what the user wrote, and the write is the thing we cannot redo for
  // them. A rejected submit keeps the text so it can be retried.
  const handleSubmit = () => {
    const result = onSubmit?.(values);
    if (!resetOnSubmit) return;
    void Promise.resolve(result).then(
      () => setValues(initValues(fields)),
      () => {},
    );
  };
  return (
    <MeridianForm
      fields={buildFields(fields, values, setAt, disabled)}
      description={description || undefined}
      submit={{ label: submitLabel, disabled: submitDisabled, onSubmit: handleSubmit }}
    />
  );
}

/** True when every leaf of a form's INITIAL values is empty. */
function startsBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.every(startsBlank);
  if (typeof value === "object") return Object.values(value as object).every(startsBlank);
  return false;
}

function FormShape({ panel, invoker }: { panel: FormPanel; invoker: RpcInvoker }): ReactNode {
  const edit = panel.mode === FormMode.EDIT;
  // Does this form CREATE something, or edit something that already exists? The
  // descriptor doesn't say, so read it off the fields: a form that opens blank is
  // composing a new thing (a comment, a quick-create), and should clear once the
  // submit lands. A form pre-filled from a record is editing it, and clearing
  // would wipe the record from view. Deriving it beats assuming — every
  // FormPanel(EDIT) the projection emits today is a create surface (an existing
  // record renders as a RecordCardPanel), and this keeps holding when that stops
  // being true.
  const createLike = edit && startsBlank(initValues(panel.fields));
  const selection = useMeridianSelection();
  // Submit honours the call's BINDINGS, exactly as `populate` does. A submit
  // request is not only what the user typed: an op scoped to the record it hangs
  // off (post a comment on THIS task → `resourceId`) gets that field from a
  // binding, because it is context, not input — there is no form control for it
  // and there should not be. Previously submit sent the form values alone, so a
  // bound op could never be satisfied: the scope field simply never arrived, and
  // the only workarounds were a fake editable input or a bespoke panel.
  //
  // Field values WIN over bindings on a key collision — the binding supplies the
  // context the form cannot, never overrides what the user actually entered.
  return (
    <FieldForm
      fields={panel.fields}
      disabled={!edit}
      submitLabel={edit ? `Save ${panel.itemNoun || ""}`.trim() : "Save"}
      submitDisabled={!edit}
      onSubmit={
        edit
          ? (values) =>
              invoke(invoker, panel.submit, {
                ...buildBindingRequest(panel.submit, selection.values),
                ...(values as Row),
              })
          : undefined
      }
      resetOnSubmit={createLike}
    />
  );
}

function PromptShape({ panel }: { panel: PromptPanel }): ReactNode {
  return (
    <FieldForm
      fields={panel.fields}
      disabled={false}
      description={panel.description || undefined}
      submitLabel={panel.acceptLabel || "Submit"}
    />
  );
}

function LroShape({ panel, invoker }: { panel: LroPanel; invoker: RpcInvoker }): ReactNode {
  if (panel.inputs.length > 0) {
    return (
      <FieldForm
        fields={panel.inputs}
        disabled={false}
        submitLabel={panel.runButtonLabel || "Run"}
        onSubmit={(values) => invoke(invoker, panel.start, values as Row)}
      />
    );
  }
  return (
    <Button variant="contained" onClick={() => invoke(invoker, panel.start)}>
      {panel.runButtonLabel || "Run"}
    </Button>
  );
}

// ── Chrome / Fallback / ActionBar ────────────────────────────────────────────

function Chrome({
  descriptor,
  children,
}: {
  descriptor: PanelDescriptor;
  children: ReactNode;
}): ReactNode {
  // MeridianMuiProvider already installs the mode-correct MUI ThemeProvider over
  // the whole subtree. Rebuilding a theme here via themeProtoToMuiTheme(theme)
  // dropped the mode → every panel fell back to the LIGHT theme, so dark-mode
  // tables rendered as dim/unreadable text on the dark page. Just wrap the panel;
  // it inherits the provider's (correct-mode) theme.
  return (
    <Box className="mer-panel" data-panel={descriptor.panelId}>
      {children}
    </Box>
  );
}

function Fallback({ descriptor }: { descriptor: PanelDescriptor }): ReactNode {
  return (
    <Alert severity="warning" className="mer-fallback">
      {descriptor.body.case
        ? `unsupported panel shape: ${descriptor.body.case}`
        : "(empty panel)"}
    </Alert>
  );
}

function ActionBar({ actions, invoker }: ActionBarProps): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { subjectKind } = useContext(MeridianViewContext);
  const onAction = useActionHandler();
  // Fire a header/overflow action: RpcCall actions go through the invoker; no-call
  // actions (host-resolved keys — nav/custom) route to the host's onAction with
  // the view subject (no row id at the header level).
  const fire = (action: Action): void => {
    if (action.call) {
      invoke(invoker, action.call);
      return;
    }
    onAction?.(action.id, subjectKind);
  };
  if (!actions || actions.length === 0) return null;
  // OVERFLOW actions collapse into a kebab (⋮) menu; the rest render inline
  // (PRIMARY = contained, others = outlined). Honors the projected placement.
  const inline = actions.filter((a: Action) => a.placement !== ActionPlacement.OVERFLOW);
  const overflow = actions.filter((a: Action) => a.placement === ActionPlacement.OVERFLOW);
  return (
    <Stack direction="row" spacing={1} alignItems="center" className="mer-actions">
      {inline.map((action: Action) => (
        <Button
          key={action.id}
          size="small"
          variant={action.placement === ActionPlacement.PRIMARY ? "contained" : "outlined"}
          onClick={() => fire(action)}
        >
          {action.label}
        </Button>
      ))}
      {overflow.length > 0 && (
        <>
          <IconButton
            size="small"
            aria-label="more actions"
            className="mer-actions-overflow"
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            <Box component="span" sx={{ fontSize: 20, lineHeight: 1 }}>
              &#8942;
            </Box>
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {overflow.map((action: Action) => (
              <MenuItem
                key={action.id}
                onClick={() => {
                  setAnchor(null);
                  fire(action);
                }}
              >
                {action.label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Stack>
  );
}

function themeToStyle(theme: Theme | undefined): CSSProperties {
  const palette = theme?.light;
  if (!palette) return {};
  return { background: palette.bg || undefined, color: palette.fg || undefined };
}

/** The MUI ComponentKit — plug into MeridianProvider / reactWebRenderer. */
export const muiKit: ComponentKit = {
  id: "mui",
  themeToStyle,
  Chrome,
  Table: ({ panel, invoker }: ShapeProps<TablePanel>) => (
    <TableShape panel={panel} invoker={invoker} />
  ),
  Prompt: ({ panel }: ShapeProps<PromptPanel>) => <PromptShape panel={panel} />,
  Lro: ({ panel, invoker }: ShapeProps<LroPanel>) => (
    <LroShape panel={panel} invoker={invoker} />
  ),
  Form: ({ panel, invoker }: ShapeProps<FormPanel>) => (
    <FormShape panel={panel} invoker={invoker} />
  ),
  // ── detail-view shapes (MUI) ────────────────────────────────────────────────
  DetailHeader: ({ panel, invoker }: ShapeProps<DetailHeaderPanel>) => (
    <MeridianDetailHeader panel={panel} invoker={invoker} />
  ),
  RecordCard: ({ panel, invoker }: ShapeProps<RecordCardPanel>) => (
    <MeridianRecordCard panel={panel} invoker={invoker} />
  ),
  // Image/media gallery — lightbox (stage + filmstrip) when the CardSpec has an
  // image_field, else a responsive card grid. See components/gallery.tsx.
  Gallery: ({ panel, invoker }: ShapeProps<GalleryPanel>) => (
    <MeridianGallery panel={panel} invoker={invoker} />
  ),
  // ── content shapes (MUI) ────────────────────────────────────────────────────
  Choice: ({ panel }: ShapeProps<ChoicePanel>) => <ChoiceView panel={panel} />,
  Snippet: ({ panel }: ShapeProps<SnippetPanel>) =>
    panel.snippet ? <SnippetView snippet={panel.snippet} /> : null,
  Action: ({ panel }: ShapeProps<ActionPanel>) => <ActionView panel={panel} />,
  ConnectFlow: ({ panel }: ShapeProps<ConnectFlowPanel>) => (
    <ConnectFlowView panel={panel} />
  ),
  CopyValue: ({ panel }: ShapeProps<CopyValuePanel>) =>
    panel.value ? <CopyValueView value={panel.value} /> : null,
  Catalog: ({ panel }: ShapeProps<CatalogPanel>) => <CatalogView panel={panel} />,
  Grammar: ({ panel }: ShapeProps<GrammarPanel>) => <GrammarView panel={panel} />,
  Stat: ({ panel }: ShapeProps<StatPanel>) => <StatView panel={panel} />,
  Steps: ({ panel }: ShapeProps<StepsPanel>) => <StepsView panel={panel} />,
  Media: ({ panel }: ShapeProps<MediaPanel>) => <MediaView panel={panel} />,
  Fallback,
  ActionBar,
};

