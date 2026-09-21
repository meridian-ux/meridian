// MeridianChart — the standalone MUI realization of ChartSpec.
//
// ChartSpec is intentionally not tied to a charting library. This component
// provides the MUI package's portable baseline: it fetches the optional
// populate response, resolves rows_field, and renders a compact, readable
// table that preserves the chart's x/y/series intent. Hosts can still provide
// a richer chart through the web renderer's host seam.

import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Alert,
  Card,
  CardContent,
  CircularProgress,
  Table as MuiTable,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import {
  buildBindingRequest,
  selectionDeps,
  useMeridianSelection,
  resolvePath,
} from "@savvifi/meridian-web-react";
import type { ChartPanel, ChartSpec } from "@savvifi/meridian-proto-ts/proto/chart_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

type Row = Record<string, unknown>;

const MAX_ROWS = 20;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function markName(mark: number): string {
  return ["chart", "line", "area", "bar", "point", "stat"][mark] ?? "chart";
}

function fieldsFor(spec: ChartSpec): string[] {
  return [spec.x?.fieldName, spec.y?.fieldName, spec.series?.fieldName].filter(
    (field): field is string => Boolean(field),
  );
}

function rowsFromResponse(response: unknown, rowsField: string): Row[] {
  const value = rowsField ? resolvePath(response, rowsField) : response;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Row => Boolean(row) && typeof row === "object");
}

export function MeridianChart({ panel, invoker }: { panel: ChartPanel; invoker: RpcInvoker }): ReactNode {
  const spec = panel.chart;
  const selection = useMeridianSelection();
  const selectionKey = selectionDeps(spec?.populate, selection.values);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(Boolean(spec?.populate));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!spec?.populate) {
      setRows([]);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);
    const request = buildBindingRequest(spec.populate, selection.values);
    void invoker
      .invoke(spec.populate.service, spec.populate.method, request)
      .then((response) => {
        if (!cancelled) setRows(rowsFromResponse(response, spec.rowsField));
      })
      .catch(() => {
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
    // selectionKey is the stable dependency for only the selection keys this
    // call binds; the selection bag itself is intentionally a fresh object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, invoker, selectionKey]);

  const fields = useMemo(() => (spec ? fieldsFor(spec) : []), [spec]);

  if (!spec) {
    return <Alert severity="warning">Chart descriptor is empty.</Alert>;
  }

  return (
    <Card variant="outlined" className="mer-chart" data-mark={markName(spec.mark)}>
      <CardContent>
        {spec.title && <Typography variant="h6" className="mer-chart-title">{spec.title}</Typography>}
        <Typography variant="body2" color="text.secondary" className="mer-chart-summary">
          {markName(spec.mark)} of {spec.y?.fieldName || "value"} by {spec.x?.fieldName || "category"}
        </Typography>

        {loading ? (
          <CircularProgress size={20} aria-label="Loading chart data" sx={{ mt: 2 }} />
        ) : error ? (
          <Alert severity="error" sx={{ mt: 2 }}>Unable to load chart data.</Alert>
        ) : rows.length > 0 && fields.length > 0 ? (
          <MuiTable size="small" sx={{ mt: 2 }} className="mer-chart-data">
            <TableHead>
              <TableRow>
                {fields.map((field) => <TableCell key={field}>{field}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.slice(0, MAX_ROWS).map((row, index) => (
                <TableRow key={index}>
                  {fields.map((field) => <TableCell key={field}>{asText(resolvePath(row, field))}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </MuiTable>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No chart data.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
