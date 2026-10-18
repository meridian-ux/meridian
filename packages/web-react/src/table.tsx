import { useCallback, useContext, useMemo, useState } from "react";
import { ColumnFormat, type TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { normalizeLegacyAction, normalizeTableActions, formatByDisplay, formatLegacyNumber, isSafeHttpUrl, resolveValueLink, type NormalizedAction, type RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { useDisplayNow } from "./display_now.js";
import { resolvePath, selectionDeps, useMeridianSelection, usePagedRows } from "./pagination.js";
import { useHrefResolver } from "./provider.js";
import { MeridianViewContext, MeridianRowActionsContext, MeridianNormalizedRowActionsContext } from "./view_renderer.js";
import { ActionControl } from "./action_control.js";
import { ActionGroup } from "./action_group.js";

type Row = Record<string, unknown>;

function safeHref(href: string | undefined): string | undefined {
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return undefined;
  try {
    return ["http:", "https:"].includes(new URL(href, "https://meridian.invalid/").protocol) ? href : undefined;
  } catch { return undefined; }
}

function TableRowActions({ actions, row, onSuccess, styled }: {
  actions: readonly NormalizedAction[];
  row: Row | undefined;
  onSuccess: () => Promise<void>;
  styled: boolean;
}) {
  const { subjectKind } = useContext(MeridianViewContext);
  const id = row && Object.getOwnPropertyDescriptor(row, "id");
  const entityId = id && "value" in id && (typeof id.value === "string" || typeof id.value === "number") ? id.value as string | number : undefined;
  return <ActionGroup><div className={styled ? "mb-3 flex flex-wrap items-center gap-2" : "mer-table-actions"} role="group" aria-label="Row actions">
    {actions.map((action, index) => <ActionControl key={action.affordance.id || index} action={action}
      options={{ row, enabled: !!row, subject: { entityType: subjectKind, entityId }, refresh: onSuccess }}
      className={styled ? "inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50" : undefined} />)}
  </div></ActionGroup>;
}

/** Reference-kit table presentation; fetching and server paging use the shared hook. */
export function TableContent({ panel, invoker, styled = false }: { panel: TablePanel; invoker: RpcInvoker; styled?: boolean }) {
  const data = usePagedRows(panel, invoker);
  const selection = useMeridianSelection();
  const selectionKey = selectionDeps(panel.populate, selection.values);
  const scope = useMemo(() => ({}), [panel, invoker, data.page, selectionKey]);
  const [selected, setSelected] = useState<{ scope: object; rows: Row[]; index: number }>();
  // No stable row-key field is declared by TablePanel. A new result must never
  // inherit an old row's index, including across pages and selection-bound reads.
  const selectedIndex = !data.loading && !data.error && selected?.scope === scope && selected.rows === data.rows ? selected.index : -1;
  const selectedRow = data.rows[selectedIndex];
  const legacyViewActions = useContext(MeridianRowActionsContext);
  const canonicalViewActions = useContext(MeridianNormalizedRowActionsContext);
  const actions = [...normalizeTableActions(panel), ...(canonicalViewActions ?? legacyViewActions.map(normalizeLegacyAction))];
  const selectable = actions.length > 0;
  const refresh = useCallback(async () => { setSelected(undefined); data.refresh(); }, [data.refresh]);
  const select = (index: number) => {
    if (!data.loading && !data.error) setSelected({ scope, rows: data.rows, index });
  };
  const now = useDisplayNow();
  const resolveHref = useHrefResolver();
  const { subjectKind } = useContext(MeridianViewContext);
  const message = data.error ? "Failed to load table." : panel.placeholder || (data.loading || !panel.populate ? "(load to populate)" : "No rows.");
  return <>
    {selectable && <TableRowActions actions={actions} row={selectedRow} styled={styled} onSuccess={refresh} />}
    <table className={styled ? "w-full caption-bottom text-sm" : "mer-table"} aria-busy={data.loading || undefined}>
      <thead><tr>{panel.columns.map((column, index) => <th scope="col" key={index}>{column.header}</th>)}</tr></thead>
      <tbody>{data.error || !data.rows.length ? <tr><td className={styled ? "p-2 align-middle text-muted-foreground" : "mer-empty"} colSpan={panel.columns.length || 1}>{message}</td></tr> : data.rows.map((row, index) => <tr key={index}
        data-row={selectable ? index : undefined}
        tabIndex={selectable && !data.loading ? 0 : undefined}
        aria-selected={selectable ? index === selectedIndex : undefined}
        data-state={selectable && index === selectedIndex ? "selected" : undefined}
        className={selectable ? styled ? "cursor-pointer hover:bg-muted/50 data-[state=selected]:bg-muted" : index === selectedIndex ? "mer-table-row selected" : "mer-table-row" : undefined}
        style={selectable && !styled && index === selectedIndex ? { background: "var(--mer-selection, rgba(127, 127, 127, 0.15))" } : undefined}
        onClick={selectable ? event => { if (!(event.target as Element).closest("a, button, input, select, textarea")) select(index); } : undefined}
        onKeyDown={selectable ? event => {
          // A cell link keeps its own keyboard activation and navigation.
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            select(index);
          }
        } : undefined}>{panel.columns.map((column, columnIndex) => {
        const raw = resolvePath(row, column.fieldPath);
        const display = column.valueDisplay;
        const shown = display ? formatByDisplay(raw, display, now) : { text: raw == null ? "" : column.format === ColumnFormat.FLOAT_2DP && typeof raw === "number" ? formatLegacyNumber(raw, column.format) : column.format === ColumnFormat.STRING_LIST && Array.isArray(raw) ? raw.join(", ") : typeof raw === "object" ? JSON.stringify(raw) : String(raw) };
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
