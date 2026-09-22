import { useEffect, useState, type ReactNode } from "react";

import type { ChartPanel, ChartSpec } from "@savvifi/meridian-proto-ts/proto/chart_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import {
  buildBindingRequest,
  resolvePath,
  selectionDeps,
  useMeridianSelection,
} from "./pagination.js";

type Row = Record<string, unknown>;

export interface ChartClasses {
  figure: string;
  title?: string;
  summary?: string;
  status?: string;
  table?: string;
}

const MAX_ROWS = 20;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
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
  return Array.isArray(value)
    ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

/**
 * Portable reference-kit chart fallback. It preserves the chart's field intent
 * as a readable table when a host has no richer chart transcoder.
 */
export function ChartContent({ panel, invoker, classes }: {
  panel: ChartPanel;
  invoker: RpcInvoker;
  classes: ChartClasses;
}): ReactNode {
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
    void invoker.invoke(spec.populate.service, spec.populate.method, request)
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
    // selectionKey covers only the live selection keys this call binds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, invoker, selectionKey]);

  if (!spec) return <p className={classes.status}>Chart descriptor is empty.</p>;

  const fields = fieldsFor(spec);
  return (
    <figure className={classes.figure} data-mark={markName(spec.mark)}>
      {spec.title && <figcaption className={classes.title}>{spec.title}</figcaption>}
      <p className={classes.summary}>
        {markName(spec.mark)} of {spec.y?.fieldName || "value"} by {spec.x?.fieldName || "category"}
      </p>
      {spec.populate && (loading ? (
        <p className={classes.status} role="status">Loading chart data…</p>
      ) : error ? (
        <p className={classes.status} role="alert">Unable to load chart data.</p>
      ) : rows.length > 0 && fields.length > 0 ? (
        <table className={classes.table}>
          <thead><tr>{fields.map((field) => <th key={field} scope="col">{field}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((row, index) => (
              <tr key={index}>
                {fields.map((field) => <td key={field}>{asText(resolvePath(row, field))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={classes.status}>No chart data.</p>
      ))}
    </figure>
  );
}
