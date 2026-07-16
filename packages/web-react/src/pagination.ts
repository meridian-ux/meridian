// Pagination — the kit-agnostic brain that turns a meridian.ui.v1 TablePanel's
// `Pagination` into fetched rows + page controls, via the RpcInvoker.
//
// Every kit's Table component can drive its own pager off `usePagedRows`, so the
// three modes behave identically regardless of the component library:
//   - CLIENT  fetch once (no page params); return ALL rows — the kit's table
//             paginates them locally (e.g. MUI TablePagination). Good for small lists.
//   - OFFSET  re-invoke `populate` per page with offset/limit request fields; read
//             the total-count response for page count.
//   - CURSOR  re-invoke `populate` with a cursor request field; read the next-cursor
//             response (empty ⇒ end). Page-at-a-time (a visited-cursor stack backs prev).
//
// The request/response field wiring is pure + separately testable
// (`buildPageRequest` / `readPage`); the hook is thin glue over them.

import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
  PaginationMode,
  type Pagination,
  type TablePanel,
} from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

export { PaginationMode } from "@savvifi/meridian-proto-ts/proto/table_pb.js";

const DEFAULT_PAGE_SIZE = 20;

type Row = Record<string, unknown>;

/** A pre-fetched page-0 result to seed a table for SSR/hydration (no refetch flash). */
export interface MeridianPageSeed {
  rows: Row[];
  total?: number;
  nextCursor?: string;
}
/** SSR seed map, keyed by a populate call's `${service}.${method}`. */
export type MeridianInitialData = Record<string, MeridianPageSeed>;
/**
 * Server-computed initial page data, provided by ViewRenderer's `initialData`.
 * usePagedRows reads it to seed page-0 state so SSR renders real rows and the
 * client hydrates without an immediate refetch. Undefined ⇒ normal fetch-on-mount.
 */
export const MeridianInitialDataContext = createContext<MeridianInitialData | undefined>(undefined);

/**
 * The ambient RECORD for a repeated sub_view item (a Slot with sub_view +
 * sub_view_populate renders sub_view once per row, each wrapped in this context
 * with the row as the record). Panels inside a repeated sub_view that have NO
 * `populate` of their own read from it: `useRecord` returns it (FormPanel /
 * DetailHeaderPanel bind their fields to the row), and `usePagedRows` takes its
 * rows from the row's `rows_field` (a nested TablePanel over `record.<field>`).
 * Undefined outside a repeater — panels then behave exactly as before (fetch).
 */
export const MeridianRecordContext = createContext<Row | undefined>(undefined);

/**
 * A view-scoped SELECTION bag: a flat `key → value` map that one panel publishes
 * into and SIBLING panels read. This is meridian's cross-panel channel — the only
 * state that flows sideways rather than down. It exists for one shape: a scope
 * picker ("which plan year is this page about?") that re-parameterizes other
 * panels' `populate` calls (FieldBinding.selection_key) and gates whole slots
 * (Slot.depends_on_selection_key).
 *
 * Values are STRINGS (ids): a key names a scope, an unset scope is exactly
 * `!value`, and a string is what a request field and a URL both want. A producer
 * that also wants a display label just writes a second key (e.g.
 * `selectedPlanYearIdLabel`) — the bag is flat on purpose.
 */
export interface MeridianSelection {
  values: Record<string, string>;
  /** Publish a key. `undefined` / "" clears it (and closes any gate on it). */
  set: (key: string, value: string | undefined) => void;
}

/**
 * The context default: an inert bag. ViewRenderer compares the inherited context
 * value against THIS identity to tell "no enclosing view" from "a real parent
 * scope" (a nested sub_view shares its parent's bag; a top-level view owns state).
 */
export const EMPTY_SELECTION: MeridianSelection = { values: {}, set: () => {} };

/**
 * The ambient selection bag. ViewRenderer always provides one, so the hooks read
 * it without a null dance; the default is inert for kits/tests that render a panel
 * outside any ViewRenderer.
 */
export const MeridianSelectionContext = createContext<MeridianSelection>(EMPTY_SELECTION);

export function useMeridianSelection(): MeridianSelection {
  return useContext(MeridianSelectionContext);
}

/**
 * Resolve a call's FieldBindings into request fields. Only two sources are
 * meaningful for a `populate`:
 *   - `literal`      — an authored (or projection-constant-folded) scalar.
 *   - `selectionKey` — the CURRENT value of a view selection key: the only binding
 *     source that reads live client state.
 * The other sources (context / row_field / form_field / signal / nested) belong to
 * the action / LRO / grammar tiers — a populate has no row, form or signal — and
 * are skipped here.
 *
 * A selection key that is unset contributes NOTHING: the field is OMITTED, never
 * sent as undefined/null/"". An unset scope must not silently widen the query. Pure.
 */
export function buildBindingRequest(
  call: RpcCall | undefined,
  selection: Record<string, string>,
): Row {
  const request: Row = {};
  for (const binding of call?.bindings ?? []) {
    let value: unknown;
    if (binding.source.case === "literal") {
      value = binding.source.value;
    } else if (binding.source.case === "selectionKey") {
      value = selection[binding.source.value];
    } else {
      continue;
    }
    if (value === undefined || value === null || value === "") continue;
    setNested(request, binding.requestField, value);
  }
  return request;
}

/**
 * The refetch key for a call's selection dependencies: a stable STRING over just
 * the keys it binds and their current values.
 *
 * This is the whole anti-loop design. The bag is a fresh object on every publish;
 * keying an effect on it would refetch every panel on every pick — the identity
 * trap that made RepeatedSubView loop. A derived string means a panel with NO
 * selection bindings gets "" forever and never refetches, so every descriptor
 * shipped before selection is bit-for-bit unaffected. Pure.
 */
export function selectionDeps(
  call: RpcCall | undefined,
  selection: Record<string, string>,
): string {
  let key = "";
  for (const binding of call?.bindings ?? []) {
    if (binding.source.case !== "selectionKey") continue;
    key += `${binding.source.value}=${selection[binding.source.value] ?? ""};`;
  }
  return key;
}

/** True when a call reads live selection state — so it can never consume an SSR
 *  seed (the server cannot know a client-picked scope). */
export function hasSelectionBindings(call: RpcCall | undefined): boolean {
  return (call?.bindings ?? []).some((b) => b.source.case === "selectionKey");
}

/** Follow a dotted path (e.g. "page.offset") into a value. */
function getNested(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

/** Set a dotted path (e.g. "page.offset") on a request object, creating parents. */
function setNested(target: Row, path: string, value: unknown): void {
  if (!path) return;
  const keys = path.split(".");
  let cursor: Row = target;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Row;
  }
  cursor[keys[keys.length - 1]] = value;
}

/** Effective mode (UNSPECIFIED ⇒ CLIENT) + page size (0 ⇒ default) for a panel. */
export function resolvePagination(panel: TablePanel): {
  pagination?: Pagination;
  mode: PaginationMode;
  pageSize: number;
} {
  const pagination = panel.pagination;
  let mode = pagination?.mode ?? PaginationMode.CLIENT;
  if (mode === PaginationMode.UNSPECIFIED) mode = PaginationMode.CLIENT;
  const pageSize =
    pagination?.pageSize && pagination.pageSize > 0
      ? pagination.pageSize
      : DEFAULT_PAGE_SIZE;
  return { pagination, mode, pageSize };
}

/** Build the `populate` request for a page. CLIENT ⇒ {}. Pure. */
export function buildPageRequest(
  pagination: Pagination | undefined,
  opts: { page?: number; cursor?: string; pageSize?: number },
): Row {
  const request: Row = {};
  if (!pagination) return request;
  const pageSize =
    opts.pageSize && opts.pageSize > 0
      ? opts.pageSize
      : pagination.pageSize > 0
        ? pagination.pageSize
        : DEFAULT_PAGE_SIZE;
  if (pagination.mode === PaginationMode.OFFSET) {
    const page = opts.page ?? 0;
    if (pagination.offsetRequestField)
      setNested(request, pagination.offsetRequestField, page * pageSize);
    if (pagination.limitRequestField)
      setNested(request, pagination.limitRequestField, pageSize);
  } else if (pagination.mode === PaginationMode.CURSOR) {
    if (pagination.cursorRequestField && opts.cursor)
      setNested(request, pagination.cursorRequestField, opts.cursor);
    // Send the requested page size so the server pages at that size (else it uses
    // its own default — and a page-size selector would be inert). The projection
    // points `limitRequestField` at the op's page-size input (aion list: "pageSize").
    if (pagination.limitRequestField)
      setNested(request, pagination.limitRequestField, pageSize);
  }
  return request;
}

/** Read a page (rows + total + next cursor) out of a `populate` response. Pure. */
export function readPage(
  pagination: Pagination | undefined,
  response: unknown,
  rowsField: string,
): { rows: Row[]; total?: number; nextCursor?: string } {
  const list = getNested(response, rowsField);
  const rows = Array.isArray(list) ? (list as Row[]) : [];
  let total: number | undefined;
  let nextCursor: string | undefined;
  if (pagination?.totalField) {
    const value = getNested(response, pagination.totalField);
    total = typeof value === "number" ? value : Number(value) || undefined;
  }
  if (pagination?.nextCursorField) {
    const value = getNested(response, pagination.nextCursorField);
    nextCursor = typeof value === "string" ? value : undefined;
  }
  return { rows, total, nextCursor };
}

export interface PagedTable {
  mode: PaginationMode;
  pageSize: number;
  rows: Row[];
  loading: boolean;
  /** 0-based page index (OFFSET / CURSOR). */
  page: number;
  /** Total rows (OFFSET; CLIENT reports the fetched count). */
  total?: number;
  hasPrev: boolean;
  hasNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  /** Jump to a page (OFFSET only; no-op otherwise). */
  setPage: (page: number) => void;
  /** Change the page size (page-size selector): resets to page 0 and refetches
   *  CURSOR/OFFSET at the new size; CLIENT re-slices locally. */
  setPageSize: (size: number) => void;
  /** True when the populate RPC rejected — so the kit shows an error, not "no data". */
  error: boolean;
}

/**
 * Fetch + page a TablePanel's rows through the invoker. CLIENT returns all rows
 * (the kit's table paginates locally); OFFSET / CURSOR fetch one page at a time.
 */
export function usePagedRows(panel: TablePanel, invoker: RpcInvoker): PagedTable {
  const { pagination, mode, pageSize: resolvedPageSize } = resolvePagination(panel);
  // Renderer-changeable page size (drives the page-size selector). Init from the
  // panel; changing it resets to page 0 and refetches (CURSOR/OFFSET).
  const [pageSize, setPageSizeState] = useState(resolvedPageSize);
  // SSR seed for this table's populate call, if the host provided one. A populate
  // that binds live selection is NOT seedable — the server pre-fetches before any
  // client scope exists, so its seed would be garbage under a key the client trusts.
  const initialData = useContext(MeridianInitialDataContext);
  const seed =
    panel.populate && initialData && !hasSelectionBindings(panel.populate)
      ? initialData[`${panel.populate.service}.${panel.populate.method}`]
      : undefined;

  // The view selection bag. `selectionKey` is a derived string over just the keys
  // this populate binds — a panel with none gets "" and never refetches on a pick.
  const selection = useMeridianSelection();
  const selectionKey = selectionDeps(panel.populate, selection.values);

  // Record-scoped rows: a TablePanel with NO populate inside a repeated sub_view
  // takes its rows from the ambient record's `rows_field` (no fetch, CLIENT-paged).
  const ambientRecord = useContext(MeridianRecordContext);
  const recordRows: Row[] | undefined =
    !panel.populate && ambientRecord ? ((resolvePath(ambientRecord, panel.rowsField) as Row[]) ?? []) : undefined;

  const [page, setPageState] = useState(0);
  // Cursor visited for each page index (CURSOR mode); index 0 = "" (first page).
  const [cursorStack, setCursorStack] = useState<string[]>([""]);
  const [rows, setRows] = useState<Row[]>(seed?.rows ?? recordRows ?? []);
  const [total, setTotal] = useState<number | undefined>(
    seed ? (mode === PaginationMode.CLIENT ? seed.rows.length : seed.total) : recordRows?.length,
  );
  const [nextCursor, setNextCursor] = useState<string | undefined>(seed?.nextCursor);
  const [loading, setLoading] = useState<boolean>(Boolean(panel.populate) && !seed);
  const [error, setError] = useState<boolean>(false);
  // When SSR-seeded, the page-0 rows are already in state, so skip the first
  // client fetch on mount (keeps the server-rendered rows — no hydration flash).
  // Consumed once; later page changes fetch normally.
  const seedPendingRef = useRef<boolean>(Boolean(seed));

  // Reset paging when the panel identity OR the bound selection changes — a cursor
  // is meaningless under a new scope.
  useEffect(() => {
    setPageState(0);
    setCursorStack([""]);
    setPageSizeState(resolvedPageSize);
  }, [panel, resolvedPageSize, selectionKey]);

  useEffect(() => {
    if (!panel.populate) {
      // Record-scoped: rows come from the ambient record (no fetch). Kept in sync
      // in case the record changes for this instance.
      if (recordRows) {
        setRows(recordRows);
        setTotal(recordRows.length);
      }
      setLoading(false);
      return;
    }
    // Consume the SSR seed on the first mount at page 0 — state already holds the
    // page-0 rows, so don't refetch.
    if (seedPendingRef.current && page === 0) {
      seedPendingRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const cursor = mode === PaginationMode.CURSOR ? cursorStack[page] ?? "" : undefined;
    const request = {
      ...buildBindingRequest(panel.populate, selection.values),
      ...(mode === PaginationMode.CLIENT
        ? {}
        : buildPageRequest(pagination, { page, cursor, pageSize })),
    };
    invoker
      .invoke(panel.populate.service, panel.populate.method, request)
      .then((response) => {
        if (cancelled) return;
        const read = readPage(pagination, response, panel.rowsField);
        setRows(read.rows);
        setTotal(mode === PaginationMode.CLIENT ? read.rows.length : read.total);
        setNextCursor(read.nextCursor);
      })
      .catch(() => {
        // Surface the failure — a table that shows "no data" on a failed fetch is
        // a UI mishap (the user reads it as "there are none").
        if (!cancelled) {
          setRows([]);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // cursorStack is intentionally omitted: goNext updates it together with page,
    // so the page change drives the refetch. pageSize is included so a page-size
    // change refetches CURSOR/OFFSET at the new size. selectionKey refetches when a
    // bound selection value changes (and is "" — stable — for unbound panels).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, invoker, page, mode, pageSize, selectionKey]);

  const hasPrev = page > 0;
  const hasNext =
    mode === PaginationMode.OFFSET
      ? total !== undefined
        ? (page + 1) * pageSize < total
        : rows.length === pageSize
      : mode === PaginationMode.CURSOR
        ? Boolean(nextCursor)
        : false; // CLIENT: the kit's own pager decides

  const goNext = () => {
    if (mode === PaginationMode.CURSOR) {
      if (!nextCursor) return;
      setCursorStack((stack) => {
        const next = [...stack];
        next[page + 1] = nextCursor;
        return next;
      });
    }
    setPageState((current) => current + 1);
  };
  const goPrev = () => setPageState((current) => (current > 0 ? current - 1 : current));
  const setPage = (target: number) => {
    if (mode === PaginationMode.OFFSET) setPageState(Math.max(0, target));
  };
  // Change the page size: reset to page 0 + clear the cursor stack so the next
  // fetch pages at the new size (CURSOR/OFFSET refetch; CLIENT just re-slices).
  const setPageSize = (size: number) => {
    if (!Number.isFinite(size) || size <= 0 || size === pageSize) return;
    setPageSizeState(size);
    setPageState(0);
    setCursorStack([""]);
  };

  return { mode, pageSize, rows, loading, error, page, total, hasPrev, hasNext, goNext, goPrev, setPage, setPageSize };
}

/**
 * Follow a dotted path into a record (e.g. "data.sponsor" → record.data.sponsor).
 * Public helper so a kit's detail panels resolve `*_source_path` / field ids the
 * same way the table resolves cell paths. Empty path ⇒ undefined.
 */
export function resolvePath(source: unknown, path: string): unknown {
  return getNested(source, path);
}

/** The single record backing a detail panel (detail_header / record_card). */
export interface RecordState {
  /** The fetched record, or undefined until it resolves. */
  record: Row | undefined;
  /** True while the populate RPC is in flight. */
  loading: boolean;
  /** True when the populate RPC rejected. */
  error: boolean;
}

/**
 * Fetch the single record a detail panel binds to. The counterpart of
 * `usePagedRows` for a one-record view: it invokes `populate` once with the
 * request field named by `idField` (default "id") set to `subjectId`
 * (ViewDescriptor.subject_id), and — like the table — consumes an SSR seed from
 * `MeridianInitialDataContext` (a record is stored as a one-row page, so the seed
 * key is `${service}.${method}` and the record is `seed.rows[0]`) so the server
 * paint carries real values and the client hydrates without an immediate refetch.
 * No `populate` ⇒ inert (undefined record, not loading).
 */
export function useRecord(
  populate: RpcCall | undefined,
  idField: string,
  subjectId: string | undefined,
  invoker: RpcInvoker,
): RecordState {
  const initialData = useContext(MeridianInitialDataContext);
  // Record-scoped: a detail panel with NO populate inside a repeated sub_view binds
  // to the ambient record (the repeater's row) instead of fetching.
  const ambientRecord = useContext(MeridianRecordContext);
  // A populate that binds live selection is not seedable (same reason as the table).
  const seed =
    populate && initialData && !hasSelectionBindings(populate)
      ? initialData[`${populate.service}.${populate.method}`]
      : undefined;
  const seededRecord = seed?.rows?.[0];

  const selection = useMeridianSelection();
  const selectionKey = selectionDeps(populate, selection.values);

  const [record, setRecord] = useState<Row | undefined>(seededRecord);
  const [loading, setLoading] = useState<boolean>(Boolean(populate) && !seededRecord);
  const [error, setError] = useState<boolean>(false);
  // When SSR-seeded, the record is already in state — skip the first client fetch.
  const seedPendingRef = useRef<boolean>(Boolean(seededRecord));

  useEffect(() => {
    if (!populate) {
      setLoading(false);
      return;
    }
    if (seedPendingRef.current) {
      seedPendingRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const request: Row = {};
    if (subjectId != null && subjectId !== "") request[idField || "id"] = subjectId;
    // Selection bindings OVERRIDE the subject-id default. This is the documented
    // 500: the sponsor Overview card fetches `plan-year.get`, and without the
    // override `id` would stay the SPONSOR's id and the op would 500.
    Object.assign(request, buildBindingRequest(populate, selection.values));
    invoker
      .invoke(populate.service, populate.method, request)
      .then((response) => {
        if (!cancelled) setRecord(response as Row);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // selectionKey refetches when a bound selection value changes ("" for unbound).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [populate, invoker, idField, subjectId, selectionKey]);

  if (!populate && ambientRecord) return { record: ambientRecord, loading: false, error: false };
  return { record, loading, error };
}
