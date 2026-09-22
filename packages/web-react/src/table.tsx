import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { ColumnFormat, type TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { createAdmissionGate, formatByDisplay, isSafeHttpUrl, resolveValueLink, type RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { useDisplayNow } from "./display_now.js";
import { buildActionBindingRequest, resolvePath, selectionDeps, useMeridianSelection, usePagedRows } from "./pagination.js";
import { useHrefResolver, useMeridian } from "./provider.js";
import { MeridianViewContext } from "./view_renderer.js";

type Row = Record<string, unknown>;

function safeHref(href: string | undefined): string | undefined {
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return undefined;
  try {
    return ["http:", "https:"].includes(new URL(href, "https://meridian.invalid/").protocol) ? href : undefined;
  } catch { return undefined; }
}

function matchesFilter(action: TablePanel["actions"][number], row: Row): boolean {
  const filter = action.enabledWhen;
  if (!filter) return true;
  const actual = resolvePath(row, filter.fieldPath);
  return actual != null && String(actual) === filter.equals;
}

function TableRowActions({ actions, row, scope, onSuccess, styled }: {
  actions: TablePanel["actions"];
  row: Row | undefined;
  scope: object;
  onSuccess: () => void;
  styled: boolean;
}) {
  const { mutationInvoker, admission } = useMeridian();
  const selection = useMeridianSelection();
  const gate = useMemo(() => createAdmissionGate(admission), [admission]);
  const descriptionId = useId();
  // Runtime UI state only. Requests remain shaped by the descriptor's RpcCall.
  const [feedback, setFeedback] = useState<{
    scope: object; index: number; state: "pending" | "failed" | "completed"; message: string;
  }>();
  const activeAttempt = useRef<object | undefined>(undefined);
  const current = feedback?.scope === scope ? feedback : undefined;
  const pending = current?.state === "pending";

  useEffect(() => () => {
    // An old panel/page/scope cannot refresh or report errors in its replacement.
    activeAttempt.current = undefined;
  }, [scope]);

  async function activate(index: number) {
    const action = actions[index];
    const call = action?.rpc;
    if (activeAttempt.current || !row || !call?.service || !call.method || !matchesFilter(action, row)) return;
    const attempt = {};
    activeAttempt.current = attempt;
    setFeedback({ scope, index, state: "pending", message: "Running…" });
    try {
      // Consult the guarded mutation invoker even for denied attempts so the
      // host's onDenied callback is retained. Bind the raw row at activation.
      await mutationInvoker.invoke(call.service, call.method,
        buildActionBindingRequest(call, selection.values, row));
      if (activeAttempt.current !== attempt) return;
      setFeedback({ scope, index, state: "completed", message: "Completed." });
      // RowAction's non-presence proto3 bool cannot represent its documented
      // default true separately from false. Match web-components: always refresh.
      onSuccess();
    } catch {
      if (activeAttempt.current !== attempt) return;
      setFeedback({ scope, index, state: "failed", message:
        gate.admits("mutation", call.service, call.method)
          ? "Action failed. Try again." : "This action is unavailable." });
    } finally {
      if (activeAttempt.current === attempt) activeAttempt.current = undefined;
    }
  }

  return <div className={styled ? "mb-3 flex flex-wrap items-center gap-2" : "mer-table-actions"} role="group" aria-label="Row actions">
    {actions.map((action, index) => {
      const call = action.rpc;
      const denied = !!call && !gate.admits("mutation", call.service, call.method);
      const state = current?.index === index ? current : undefined;
      const id = `${descriptionId}-${index}`;
      const message = state?.message ?? (denied ? "This action is unavailable." : undefined);
      return <span key={index} className="mer-table-action">
        <button type="button"
          className={styled ? "inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50" : undefined}
          disabled={pending || !row || !call?.service || !call.method || !matchesFilter(action, row)}
          aria-disabled={denied || undefined}
          aria-busy={state?.state === "pending" || undefined}
          aria-describedby={message ? id : undefined}
          onClick={() => { void activate(index); }}>{action.label}</button>
        {message && <span id={id} role={state?.state === "failed" ? "alert" : state ? "status" : undefined}>{message}</span>}
      </span>;
    })}
  </div>;
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
  const selectable = panel.actions.length > 0;
  const select = (index: number) => {
    if (!data.loading && !data.error) setSelected({ scope, rows: data.rows, index });
  };
  const now = useDisplayNow();
  const resolveHref = useHrefResolver();
  const { subjectKind } = useContext(MeridianViewContext);
  const message = data.error ? "Failed to load table." : panel.placeholder || (data.loading || !panel.populate ? "(load to populate)" : "No rows.");
  return <>
    {selectable && <TableRowActions actions={panel.actions} row={selectedRow} scope={scope} styled={styled}
      onSuccess={() => { setSelected(undefined); data.refresh(); }} />}
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
