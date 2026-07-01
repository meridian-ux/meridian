// Pagination wiring — the pure request/response mapping the usePagedRows hook
// glues together. These prove the contract-driven field wiring deterministically
// (no React / DOM); the hook itself is exercised end-to-end in meridian-mui-kit.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  PaginationMode,
  PaginationSchema,
  TablePanelSchema,
} from "@savvifi/meridian-proto-ts/proto/table_pb.js";

import { buildPageRequest, readPage, resolvePagination } from "../src/pagination.js";

describe("resolvePagination", () => {
  it("defaults to CLIENT + page size 20 when unset", () => {
    const panel = create(TablePanelSchema, { rowsField: "items" });
    const { mode, pageSize } = resolvePagination(panel);
    expect(mode).toBe(PaginationMode.CLIENT);
    expect(pageSize).toBe(20);
  });

  it("treats UNSPECIFIED as CLIENT and honors page size", () => {
    const panel = create(TablePanelSchema, {
      rowsField: "items",
      pagination: create(PaginationSchema, {
        mode: PaginationMode.UNSPECIFIED,
        pageSize: 50,
      }),
    });
    const { mode, pageSize } = resolvePagination(panel);
    expect(mode).toBe(PaginationMode.CLIENT);
    expect(pageSize).toBe(50);
  });
});

describe("buildPageRequest", () => {
  it("OFFSET: sets offset = page*pageSize and limit (dotted paths supported)", () => {
    const pagination = create(PaginationSchema, {
      mode: PaginationMode.OFFSET,
      pageSize: 25,
      offsetRequestField: "page.offset",
      limitRequestField: "page.limit",
    });
    expect(buildPageRequest(pagination, { page: 2 })).toEqual({
      page: { offset: 50, limit: 25 },
    });
  });

  it("CURSOR: sets the cursor field only when a cursor is present", () => {
    const pagination = create(PaginationSchema, {
      mode: PaginationMode.CURSOR,
      cursorRequestField: "page_token",
    });
    expect(buildPageRequest(pagination, { cursor: "abc" })).toEqual({ page_token: "abc" });
    expect(buildPageRequest(pagination, { cursor: "" })).toEqual({});
  });

  it("CLIENT: sends no page params", () => {
    const pagination = create(PaginationSchema, { mode: PaginationMode.CLIENT });
    expect(buildPageRequest(pagination, { page: 3 })).toEqual({});
  });
});

describe("readPage", () => {
  it("OFFSET: extracts rows + total via dotted paths", () => {
    const pagination = create(PaginationSchema, {
      mode: PaginationMode.OFFSET,
      totalField: "meta.total",
    });
    const response = { items: [{ id: 1 }, { id: 2 }], meta: { total: 137 } };
    const { rows, total } = readPage(pagination, response, "items");
    expect(rows).toHaveLength(2);
    expect(total).toBe(137);
  });

  it("CURSOR: extracts rows + next cursor", () => {
    const pagination = create(PaginationSchema, {
      mode: PaginationMode.CURSOR,
      nextCursorField: "next_page_token",
    });
    const response = { rows: [{ id: 1 }], next_page_token: "next-42" };
    const { rows, nextCursor } = readPage(pagination, response, "rows");
    expect(rows).toHaveLength(1);
    expect(nextCursor).toBe("next-42");
  });

  it("missing rows field ⇒ empty page (no throw)", () => {
    const { rows } = readPage(undefined, {}, "nope");
    expect(rows).toEqual([]);
  });
});
