import { useContext } from "react";
import { ColumnFormat, type TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { formatByDisplay, isSafeHttpUrl, resolveValueLink, type RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { useDisplayNow } from "./display_now.js";
import { resolvePath, usePagedRows } from "./pagination.js";
import { useHrefResolver } from "./provider.js";
import { MeridianViewContext } from "./view_renderer.js";

function safeHref(href: string | undefined): string | undefined {
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return undefined;
  try {
    return ["http:", "https:"].includes(new URL(href, "https://meridian.invalid/").protocol) ? href : undefined;
  } catch { return undefined; }
}

/** Reference-kit table presentation; fetching and server paging use the shared hook. */
export function TableContent({ panel, invoker, styled = false }: { panel: TablePanel; invoker: RpcInvoker; styled?: boolean }) {
  const data = usePagedRows(panel, invoker);
  const now = useDisplayNow();
  const resolveHref = useHrefResolver();
  const { subjectKind } = useContext(MeridianViewContext);
  const message = data.error ? "Failed to load table." : panel.placeholder || (data.loading || !panel.populate ? "(load to populate)" : "No rows.");
  return <>
    <table className={styled ? "w-full caption-bottom text-sm" : "mer-table"} aria-busy={data.loading || undefined}>
      <thead><tr>{panel.columns.map((column, index) => <th scope="col" key={index}>{column.header}</th>)}</tr></thead>
      <tbody>{data.error || !data.rows.length ? <tr><td className={styled ? "p-2 align-middle text-muted-foreground" : "mer-empty"} colSpan={panel.columns.length || 1}>{message}</td></tr> : data.rows.map((row, index) => <tr key={index}>{panel.columns.map((column, columnIndex) => {
        const raw = resolvePath(row, column.fieldPath);
        const display = column.valueDisplay;
        const shown = display && display.type !== ValueType.UNSPECIFIED ? formatByDisplay(raw, display, now) : { text: raw == null ? "" : column.format === ColumnFormat.FLOAT_2DP && typeof raw === "number" ? raw.toFixed(2) : column.format === ColumnFormat.STRING_LIST && Array.isArray(raw) ? raw.join(", ") : typeof raw === "object" ? JSON.stringify(raw) : String(raw) };
        const link = resolveValueLink(raw, display);
        const target = column.link ? column.link.targetKind || subjectKind : link?.targetKind;
        const id = column.link ? raw == null ? "" : String(raw) : link?.id;
        const href = safeHref(target && id ? resolveHref?.(target, id) : !column.link && !display?.link && isSafeHttpUrl(raw, display) ? String(raw) : undefined);
        return <td key={columnIndex}>{href ? <a href={href} title={shown.title} rel="noopener noreferrer">{shown.text}</a> : <span title={shown.title}>{shown.text}</span>}</td>;
      })}</tr>)}</tbody>
    </table>
    {(data.hasPrev || data.hasNext) && <nav aria-label="Table pages"><button disabled={!data.hasPrev || data.loading} onClick={data.goPrev}>Previous</button><button disabled={!data.hasNext || data.loading} onClick={data.goNext}>Next</button></nav>}
  </>;
}
