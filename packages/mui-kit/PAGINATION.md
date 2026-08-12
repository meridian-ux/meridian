# Pagination in meridian (design note — next major, 0.3.0)

**Goal:** bring that library's pagination capability up into the meridian *contract* so
every renderer (MUI, web-components, TUI) paginates from one descriptor — not just
the MUI kit by accident of `DataTableView`. Requested 2026-06-30.

## Where it stands today (0.2.x)

`TablePanel` (table.proto) has **no** pagination field:

```proto
message TablePanel {
  RpcCall populate = 1;          // one call, returns the whole list
  string  rows_field = 2;
  string  item_noun = 3;
  string  placeholder = 4;
  repeated TableColumn columns = 5;
  repeated RowAction actions = 6;
}
```

`muiKit` gets **client-side** pagination *for free* because that library's
`DataTableView` wraps `usePagination` + MUI `TablePagination` over whatever rows it
is handed. That is real and useful for small lists, but:

- It is a renderer accident, not a contract guarantee — `htmlKit` / TUI don't do it.
- It only paginates rows **already fetched** — no server paging, no cursor / infinite
  scroll, so it doesn't scale to large collections.

## Proposal (0.3.0): a `Pagination` message on `TablePanel`

Additive, backward-compatible (new field `7`; absent ⇒ CLIENT ⇒ today's behavior):

```proto
message TablePanel {
  // … fields 1–6 unchanged …
  Pagination pagination = 7 [(google.api.field_behavior) = OPTIONAL];
}

// How a table pages. CLIENT paginates the fetched rows in the renderer; OFFSET and
// CURSOR re-invoke `populate` per page with renderer-supplied request fields.
message Pagination {
  PaginationMode mode = 1;
  uint32 page_size = 2;              // default rows per page (0 ⇒ renderer default)

  // OFFSET mode: request fields the renderer sets on `populate` when paging, plus
  // the response path to the total count (for page-count + "N of M").
  string offset_request_field = 3;  // e.g. "offset" or "page.offset"
  string limit_request_field  = 4;  // e.g. "limit"  or "page.size"
  string total_field          = 5;  // response path to total count

  // CURSOR mode (infinite scroll): request field carrying the cursor, plus the
  // response path to the next cursor (empty ⇒ end).
  string cursor_request_field = 6;  // e.g. "page_token"
  string next_cursor_field    = 7;  // response path, e.g. "next_page_token"
}

enum PaginationMode {
  PAGINATION_MODE_UNSPECIFIED = 0;  // treated as CLIENT
  PAGINATION_MODE_CLIENT      = 1;  // paginate fetched rows in the renderer
  PAGINATION_MODE_OFFSET      = 2;  // server paging via offset/limit + total
  PAGINATION_MODE_CURSOR      = 3;  // cursor / infinite scroll
}
```

### Renderer mapping (this kit)

| mode | a host's internal MUI component library | behavior |
| --- | --- | --- |
| CLIENT | `DataTableView` `paginated` + `pageSize` | today's free client pagination |
| OFFSET | `DataTableView` + `usePagination`, re-`populate` per page | reads `total_field` for page count; sets `offset`/`limit` request fields |
| CURSOR | `InfiniteScrollTableView` + `cursorPaginationReducer` | passes `cursor_request_field`, reads `next_cursor_field`; already exists in `that host's reducer library` |

Note all three targets already exist in that library (`usePagination`,
`cursorPaginationReducer`, `InfiniteScrollTableView`) — so the kit work is mapping,
not building.

### Alternative considered

Express offset/limit/cursor as `RpcCall` **`FieldBinding`s** (rpc.proto) with new
`ContextSource`s (`PAGE_OFFSET`, `PAGE_LIMIT`, `PAGE_CURSOR`) instead of a dedicated
`Pagination` message. Reuses existing plumbing, but scatters pagination intent across
bindings and gives renderers no single "is this table paged, and how" signal.
**Recommendation:** the dedicated `Pagination` message — explicit, one place, easy for
every renderer to switch on. The renderer synthesizes the request fields.

## Sequencing

Ship in the coordinated **0.3.0** wave (schemas → all renderers), the same shape as
the 0.2.0 ViewDescriptor wave. `muiKit` implements CLIENT (already), then OFFSET,
then CURSOR. Until then the kit keeps DataTableView's client pagination as the default.
