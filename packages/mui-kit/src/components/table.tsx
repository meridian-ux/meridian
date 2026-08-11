// MeridianTable — the kit's own MUI table (lifted from @aion/ui's DataTableView
// pattern, generalized + dependency-free). A dumb presenter: it renders the rows
// it is handed + an optional MUI TablePagination footer. All pagination logic
// (CLIENT slice / OFFSET / CURSOR fetch) lives in meridian-web-react's
// usePagedRows; this component just displays a page.
//
// Parity target = studio's old @aion/ui DataTableView (a medium-density MUI
// Table): sortable headers, clickable rows (open the entity), a page-size
// selector, a "Showing X of Y" footer, and per-row actions as a ⋮ overflow menu.

import { useState, type MouseEvent, type ReactNode } from "react";

import {
  Box,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Typography,
} from "@mui/material";

export interface MeridianColumn<T> {
  id: string;
  header: string;
  width?: string | number;
  align?: "left" | "right" | "center";
  /** When true, the header renders a clickable sort toggle (host-controlled sort). */
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

export interface MeridianTablePager {
  page: number;
  /** Total rows (CLIENT) or a hasNext-derived synthetic count (server modes). */
  count: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Page-size options for the selector; omit ⇒ the selector is hidden (locked). */
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
}

/** Host-controlled sort state (sorting happens upstream, over the full row set). */
export interface MeridianSortState {
  columnId?: string;
  direction: "asc" | "desc";
  onToggle: (columnId: string) => void;
}

/** A per-row action — a labeled item fired against a specific row. */
export interface MeridianRowAction<T> {
  id: string;
  label: string;
  onClick: (row: T) => void;
}

export interface MeridianTableProps<T> {
  columns: MeridianColumn<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  getRowKey?: (row: T, index: number) => string | number;
  pagination?: MeridianTablePager;
  /** Per-row actions rendered in a trailing ⋮ overflow-menu column (edit/delete …). */
  rowActions?: MeridianRowAction<T>[];
  /** Clicking a row (open the entity). Adds a pointer cursor + hover affordance. */
  onRowClick?: (row: T) => void;
  /** Host-controlled column sort. Absent ⇒ headers are plain (no sort). */
  sort?: MeridianSortState;
  /** Trailing meta line, e.g. "Showing 12 of 340 products". */
  footer?: ReactNode;
  /** Row density. Default "medium" (parity with the old studio DataTableView). */
  size?: "small" | "medium";
}

/** A per-row ⋮ overflow menu of the row's actions (matches the old studio
 *  TableActionsView — actions live inside each row, not a bar above the table). */
function RowActionsMenu<T>({ row, actions }: { row: T; actions: MeridianRowAction<T>[] }): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        size="small"
        aria-label="Row actions"
        onClick={(event: MouseEvent<HTMLElement>) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
      >
        <Box component="span" sx={{ fontSize: 20, lineHeight: 1 }}>
          &#8942;
        </Box>
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {actions.map((action) => (
          <MenuItem
            key={action.id}
            onClick={(event: MouseEvent<HTMLElement>) => {
              event.stopPropagation();
              setAnchor(null);
              action.onClick(row);
            }}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function MeridianTable<T>({
  columns,
  rows,
  loading = false,
  emptyMessage = "No data.",
  getRowKey,
  pagination,
  rowActions,
  onRowClick,
  sort,
  footer,
  size = "medium",
}: MeridianTableProps<T>): ReactNode {
  const hasRowActions = Boolean(rowActions && rowActions.length > 0);
  // A table with no columns can't render a meaningful grid (e.g. a list whose
  // columns are resolved at runtime). Show a clean note, never a bare pager.
  if (columns.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <Typography color="text.secondary" variant="body2">
          List — columns resolved at runtime.
        </Typography>
      </Box>
    );
  }
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <Typography color="text.secondary">{emptyMessage}</Typography>
      </Box>
    );
  }
  const showPageSizeSelector = Boolean(
    pagination?.pageSizeOptions && pagination.pageSizeOptions.length > 1 && pagination.onPageSizeChange,
  );
  // MUI TablePagination requires the active rowsPerPage to be one of the options,
  // else it drops the selector — merge the current page size in (sorted, unique).
  const pageSizeOptions =
    showPageSizeSelector && pagination
      ? Array.from(new Set([pagination.pageSize, ...pagination.pageSizeOptions!])).sort((a, b) => a - b)
      : pagination
        ? [pagination.pageSize]
        : [];
  return (
    <>
      <TableContainer>
        <Table size={size}>
          <TableHead>
            <TableRow>
              {columns.map((column) => {
                const active = sort?.columnId === column.id;
                return (
                  <TableCell key={column.id} align={column.align ?? "left"} sx={{ width: column.width }}>
                    {sort && column.sortable ? (
                      <TableSortLabel
                        active={active}
                        direction={active ? sort.direction : "asc"}
                        onClick={() => sort.onToggle(column.id)}
                      >
                        {column.header}
                      </TableSortLabel>
                    ) : (
                      column.header
                    )}
                  </TableCell>
                );
              })}
              {hasRowActions && <TableCell align="right" sx={{ width: 56 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow
                key={getRowKey ? getRowKey(row, index) : index}
                hover
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                sx={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map((column) => (
                  <TableCell key={column.id} align={column.align ?? "left"}>
                    {column.render(row)}
                  </TableCell>
                ))}
                {hasRowActions && (
                  <TableCell
                    align="right"
                    padding="checkbox"
                    sx={{ pr: 1 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <RowActionsMenu row={row} actions={rowActions!} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {footer && (
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {footer}
          </Typography>
        </Box>
      )}
      {pagination && (
        <TablePagination
          component="div"
          count={pagination.count}
          page={pagination.page}
          rowsPerPage={pagination.pageSize}
          rowsPerPageOptions={pageSizeOptions}
          onPageChange={(_event, next) => pagination.onPageChange(next)}
          onRowsPerPageChange={
            showPageSizeSelector
              ? (event) => pagination.onPageSizeChange!(Number(event.target.value))
              : undefined
          }
        />
      )}
    </>
  );
}
