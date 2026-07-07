// MeridianTable — the kit's own MUI table (lifted from @aion/ui's DataTableView
// pattern, generalized + dependency-free). A dumb presenter: it renders the rows
// it is handed + an optional MUI TablePagination footer. All pagination logic
// (CLIENT slice / OFFSET / CURSOR fetch) lives in meridian-web-react's
// usePagedRows; this component just displays a page.

import type { ReactNode } from "react";

import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from "@mui/material";

export interface MeridianColumn<T> {
  id: string;
  header: string;
  width?: string | number;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
}

export interface MeridianTablePager {
  page: number;
  /** Total rows (CLIENT) or a hasNext-derived synthetic count (server modes). */
  count: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/** A per-row action — a labeled button that fires against a specific row. */
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
  /** Per-row actions rendered in a trailing column (edit/delete …). */
  rowActions?: MeridianRowAction<T>[];
}

export function MeridianTable<T>({
  columns,
  rows,
  loading = false,
  emptyMessage = "No data.",
  getRowKey,
  pagination,
  rowActions,
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
  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell key={column.id} align={column.align ?? "left"} sx={{ width: column.width }}>
                  {column.header}
                </TableCell>
              ))}
              {hasRowActions && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={getRowKey ? getRowKey(row, index) : index} hover>
                {columns.map((column) => (
                  <TableCell key={column.id} align={column.align ?? "left"}>
                    {column.render(row)}
                  </TableCell>
                ))}
                {hasRowActions && (
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {rowActions!.map((action) => (
                        <Button
                          key={action.id}
                          size="small"
                          variant="outlined"
                          onClick={() => action.onClick(row)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </Stack>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination && (
        <TablePagination
          component="div"
          count={pagination.count}
          page={pagination.page}
          rowsPerPage={pagination.pageSize}
          rowsPerPageOptions={[pagination.pageSize]}
          onPageChange={(_event, next) => pagination.onPageChange(next)}
        />
      )}
    </>
  );
}
