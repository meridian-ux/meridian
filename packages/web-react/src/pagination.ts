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

import { useEffect, useState } from "react";

import {
  PaginationMode,
  type Pagination,
  type TablePanel,
} from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

export { PaginationMode } from "@savvifi/meridian-proto-ts/proto/table_pb.js";

const DEFAULT_PAGE_SIZE = 20;

type Row = Record<string, unknown>;

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
  opts: { page?: number; cursor?: string },
): Row {
  const request: Row = {};
  if (!pagination) return request;
  if (pagination.mode === PaginationMode.OFFSET) {
    const page = opts.page ?? 0;
    const pageSize = pagination.pageSize > 0 ? pagination.pageSize : DEFAULT_PAGE_SIZE;
    if (pagination.offsetRequestField)
      setNested(request, pagination.offsetRequestField, page * pageSize);
    if (pagination.limitRequestField)
      setNested(request, pagination.limitRequestField, pageSize);
  } else if (pagination.mode === PaginationMode.CURSOR) {
    if (pagination.cursorRequestField && opts.cursor)
      setNested(request, pagination.cursorRequestField, opts.cursor);
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
}

/**
 * Fetch + page a TablePanel's rows through the invoker. CLIENT returns all rows
 * (the kit's table paginates locally); OFFSET / CURSOR fetch one page at a time.
 */
export function usePagedRows(panel: TablePanel, invoker: RpcInvoker): PagedTable {
  const { pagination, mode, pageSize } = resolvePagination(panel);
  const [page, setPageState] = useState(0);
  // Cursor visited for each page index (CURSOR mode); index 0 = "" (first page).
  const [cursorStack, setCursorStack] = useState<string[]>([""]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(Boolean(panel.populate));

  // Reset paging when the panel identity changes.
  useEffect(() => {
    setPageState(0);
    setCursorStack([""]);
  }, [panel]);

  useEffect(() => {
    if (!panel.populate) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const cursor = mode === PaginationMode.CURSOR ? cursorStack[page] ?? "" : undefined;
    const request =
      mode === PaginationMode.CLIENT
        ? {}
        : buildPageRequest(pagination, { page, cursor });
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
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // cursorStack is intentionally omitted: goNext updates it together with page,
    // so the page change drives the refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, invoker, page, mode]);

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

  return { mode, pageSize, rows, loading, page, total, hasPrev, hasNext, goNext, goPrev, setPage };
}
