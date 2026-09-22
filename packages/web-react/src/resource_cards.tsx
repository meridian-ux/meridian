import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type {
  ActionStyle,
  ResourceAction,
  ResourceCardPanel,
} from "@savvifi/meridian-proto-ts/proto/resource_card_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { formatByDisplay, isSafeHttpUrl, resolveValueLink } from "@savvifi/meridian-schemas/uiview";

import { buildBindingRequest, resolvePath, selectionDeps, useMeridianSelection } from "./pagination.js";
import { useHrefResolver, useMutationRpcInvoker } from "./provider.js";
import { useDisplayNow } from "./display_now.js";

type Row = Record<string, unknown>;

export interface ResourceCardState {
  rows: Row[];
  loading: boolean;
  error: boolean;
}

function rowsFromResponse(response: unknown, rowsField: string): Row[] {
  const value = rowsField ? resolvePath(response, rowsField) : response;
  return Array.isArray(value)
    ? value.filter((row): row is Row => !!row && typeof row === "object")
    : [];
}

function setNested(target: Row, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    if (!child || typeof child !== "object" || Array.isArray(child)) cursor[part] = {};
    cursor = cursor[part] as Row;
  }
  cursor[parts[parts.length - 1]] = value;
}

function buildActionRequest(call: RpcCall | undefined, row: Row): Row {
  const request: Row = {};
  for (const binding of call?.bindings ?? []) {
    const source = binding.source;
    if (source.case === "rowField") {
      const value = resolvePath(row, source.value);
      if (value !== undefined && value !== null) setNested(request, binding.requestField, value);
    } else if (source.case === "literal") {
      setNested(request, binding.requestField, source.value);
    } else if (source.case === "nested") {
      const nested = buildActionRequest({ bindings: source.value.fields } as RpcCall, row);
      setNested(request, binding.requestField, nested);
    }
  }
  return request;
}

export function useResourceCardRows(
  panel: ResourceCardPanel,
  invoker: RpcInvoker,
): ResourceCardState {
  const selection = useMeridianSelection();
  const [state, setState] = useState<ResourceCardState>({ rows: [], loading: true, error: false });
  const deps = selectionDeps(panel.populate, selection.values);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: false }));
    if (!panel.populate) {
      setState({ rows: [], loading: false, error: true });
      return () => { cancelled = true; };
    }
    const request = buildBindingRequest(panel.populate, selection.values);
    invoker
      .invoke(panel.populate.service, panel.populate.method, request)
      .then((response) => {
        if (!cancelled) setState({ rows: rowsFromResponse(response, panel.rowsField), loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ rows: [], loading: false, error: true });
      });
    return () => { cancelled = true; };
  }, [deps, invoker, panel]);

  return state;
}

function visible(action: ResourceAction, row: Row): boolean {
  if (!action.visibleWhen) return true;
  const match = /^([^=]+)==(.*)$/.exec(action.visibleWhen);
  return !!match && String(resolvePath(row, match[1].trim()) ?? "") === match[2].trim();
}

function styleName(style: ActionStyle): string {
  return style === 2 ? "primary" : style === 3 ? "danger" : "default";
}

export function ResourceCardsView({
  panel,
  invoker,
}: {
  panel: ResourceCardPanel;
  invoker: RpcInvoker;
}): ReactNode {
  const { rows, loading, error } = useResourceCardRows(panel, invoker);
  const mutationInvoker = useMutationRpcInvoker();
  const resolveHref = useHrefResolver();
  const now = useDisplayNow();
  const [confirming, setConfirming] = useState<{ action: ResourceAction; row: Row } | null>(null);
  if (loading) return <div className="mer-resource-cards"><p className="mer-empty">Loading…</p></div>;
  if (error) return <div className="mer-resource-cards"><p className="mer-empty">Failed to load resources.</p></div>;
  if (!rows.length) return <div className="mer-resource-cards"><p className="mer-empty">{panel.emptyMessage || `No ${panel.itemNoun || "resources"}.`}</p></div>;
  const template = panel.template;
  if (!template) return <div className="mer-resource-cards"><p className="mer-empty">Invalid resource card descriptor.</p></div>;
  const actions = template.actions?.actions ?? [];
  const run = (action: ResourceAction, row: Row) => {
    if (!action.invoke) return;
    void mutationInvoker
      .invoke(action.invoke.service, action.invoke.method, buildActionRequest(action.invoke, row))
      .catch(() => {
        // The host admission policy reports the actionable reason through its
        // onDenied callback; the card remains mounted and retryable.
      });
  };
  return (
    <div className="mer-resource-cards" role="list">
      {rows.map((row, index) => (
        <article className="mer-resource-card" role="listitem" key={index}>
          <h3 className="mer-resource-card-title">{String(resolvePath(row, template.titleField) ?? "")}</h3>
          {template.subtitleField && <p className="mer-resource-card-subtitle">{String(resolvePath(row, template.subtitleField) ?? "")}</p>}
          {template.statusField && <span className="mer-resource-card-status">{String(resolvePath(row, template.statusField) ?? "")}</span>}
          {template.meta.length > 0 && (
            <dl className="mer-resource-card-meta">
              {template.meta.map((field, fieldIndex) => {
                const value = resolvePath(row, field.fieldPath);
                const shown = field.display ? formatByDisplay(value, field.display, now) : { text: String(value ?? "") };
                const link = resolveValueLink(value, field.display);
                const hostHref = link ? resolveHref?.(link.targetKind, link.id) : undefined;
                const external = !field.display?.link && isSafeHttpUrl(value, field.display);
                const href = hostHref || (external ? String(value) : undefined);
                return <span key={`${field.fieldPath}:${fieldIndex}`}><dt>{field.label}</dt><dd title={shown.title}>
                  {href ? <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>{shown.text}</a> : shown.text}
                </dd></span>;
              })}
            </dl>
          )}
          <div className="mer-resource-card-actions">
            {actions.filter((action) => visible(action, row)).map((action) => (
              <span key={action.id}>
                <button
                  type="button"
                  className={`mer-resource-action mer-resource-action-${styleName(action.style)}`}
                  onClick={() => action.confirm ? setConfirming({ action, row }) : run(action, row)}
                >
                  {action.label}
                </button>
                {confirming?.action === action && confirming.row === row && (
                  <span className="mer-resource-confirm" role="alertdialog">
                    <strong>{action.confirm?.title}</strong>
                    <span>{action.confirm?.message}</span>
                    <button type="button" onClick={() => { setConfirming(null); run(action, row); }}>{action.confirm?.confirmLabel || "Confirm"}</button>
                    <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
                  </span>
                )}
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
