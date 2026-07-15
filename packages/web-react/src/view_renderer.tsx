// ViewRenderer — the composition/layout tier of the React renderer.
//
// Renders a meridian.ui.v1 ViewDescriptor: applies the Layout (list / stacked /
// tabbed / two-column), delegates each Slot's panel to PanelRenderer (so the
// kit-agnostic panel dispatch is reused), and renders view- and slot-level
// Actions via the invoker. The layout STRUCTURE is kit-agnostic; the panels and
// the action affordances come from the active ComponentKit.

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { ActionPlacement } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type {
  Action,
  Slot,
  ViewDescriptor,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { PanelRenderer } from "./panel_renderer.js";
import { useMeridian } from "./provider.js";
import type { MeridianActionHandler } from "./provider.js";
import { MeridianInitialDataContext, MeridianRecordContext, usePagedRows, type MeridianInitialData } from "./pagination.js";

/**
 * Row-scoped actions (ActionPlacement.ROW), provided by ViewRenderer for the
 * active kit's table to render per-row and fire with the row bound (aion rows
 * carry `id`, so the kit invokes `{ id: row.id }`). Empty ⇒ no per-row column.
 */
export const MeridianRowActionsContext = createContext<Action[]>([]);

/**
 * The subject of the view being rendered (ViewDescriptor.subjectKind, e.g. the
 * entity type). The active kit reads this so a no-call action can tell the host's
 * onAction handler *which* entity the affordance is about. Empty on non-entity views.
 */
export const MeridianViewContext = createContext<{ subjectKind?: string; subjectId?: string }>({});

// Fire an action. Actions carrying an RpcCall go through the invoker; no-call
// actions (host-resolved keys — nav/custom) fall to the host's onAction handler
// with the view subject + optional bound row id. Binding resolution (row/form
// context → request fields) for RpcCall actions is a later increment; the first
// cut fires with an empty request and lets the invoker/backend supply defaults.
function fireAction(
  invoker: RpcInvoker,
  onAction: MeridianActionHandler | undefined,
  action: Action,
  subjectKind?: string,
  entityId?: string | number,
): void {
  if (action.call) {
    void invoker.invoke(action.call.service, action.call.method, {});
    return;
  }
  onAction?.(action.id, subjectKind, entityId);
}

function ActionsView({ actions }: { actions: Action[] }): ReactNode {
  const { kit, invoker, onAction } = useMeridian();
  const { subjectKind } = useContext(MeridianViewContext);
  if (!actions || actions.length === 0) return null;
  if (kit.ActionBar) {
    return <kit.ActionBar actions={actions} invoker={invoker} />;
  }
  return (
    <div className="mer-actions">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => fireAction(invoker, onAction, a, subjectKind)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// A REPEATED sub_view: fetch the row list (sub_view_populate → sub_view_rows_field,
// via usePagedRows in CLIENT mode) and render the sub_view template once per row,
// each wrapped in MeridianRecordContext so its no-populate panels bind to the row.
function RepeatedSubView({ slot }: { slot: Slot }): ReactNode {
  const { invoker } = useMeridian();
  // MUST be a stable object — usePagedRows keys its fetch effect on `panel`
  // identity, so an inline literal would refetch every render (→ setState → loop).
  const listPanel = useMemo(
    () => ({ populate: slot.subViewPopulate, rowsField: slot.subViewRowsField }) as unknown as TablePanel,
    [slot.subViewPopulate, slot.subViewRowsField],
  );
  const paged = usePagedRows(listPanel, invoker);
  const sub = slot.subView;
  if (!sub) return null;
  if (paged.error) return <div className="mer-slot-subview-error">Failed to load.</div>;
  return (
    <>
      {paged.rows.map((row, i) => (
        <MeridianRecordContext.Provider key={i} value={row as Record<string, unknown>}>
          <div className="mer-subview-item" data-subview-item={i}>
            <ViewRenderer view={sub} />
          </div>
        </MeridianRecordContext.Provider>
      ))}
    </>
  );
}

// One slot: an optional title, then EITHER a nested view — repeated per row when
// `sub_view_populate` is set (a dynamic list of sub-views), else a single static
// sub-view (both recursed via ViewRenderer, so every kit gets composition for free)
// — OR a panel, plus any slot (row) actions.
function SlotView({ slot }: { slot: Slot }): ReactNode {
  if (slot.subView) {
    return (
      <section className="mer-slot mer-slot-subview" data-slot={slot.id} data-role={slot.role}>
        {slot.title ? <h3 className="mer-slot-title">{slot.title}</h3> : null}
        {slot.subViewPopulate ? <RepeatedSubView slot={slot} /> : <ViewRenderer view={slot.subView} />}
        <ActionsView actions={slot.actions} />
      </section>
    );
  }
  const panel = slot.panel as PanelDescriptor | undefined;
  if (!panel) return null;
  const title = slot.title || panel.title;
  return (
    <section className="mer-slot" data-slot={slot.id} data-role={slot.role}>
      {title ? <h3 className="mer-slot-title">{title}</h3> : null}
      <PanelRenderer descriptor={panel} />
      <ActionsView actions={slot.actions} />
    </section>
  );
}

function byPosition(a: Slot, b: Slot): number {
  return (a.position || 0) - (b.position || 0);
}

function byTabPosition(a: Slot, b: Slot): number {
  return (a.placement?.tabPosition || 0) - (b.placement?.tabPosition || 0);
}

/**
 * A slot pinned INTO the view's header row (Placement.header_row) instead of
 * rendering as its own section — e.g. a scope selector that reads as part of the
 * page's identity. Partitioned in ViewRenderer rather than inside a layout branch,
 * so "inline in the header row" holds under EVERY layout mode.
 */
function isHeaderRow(slot: Slot): boolean {
  return Boolean(slot.placement?.headerRow);
}

/**
 * A slot that becomes a TAB under TabbedLayout. `tab_label` is the predicate: the
 * proto points TabbedLayout at Placement.tab_label / tab_position, and `role` is
 * advisory by contract. A tabbed view's OTHER slots (the header card, a summary)
 * are REGIONS — sections above the strip, not tabs.
 *
 * No "everything is a tab when nothing is labeled" fallback: that rule would be
 * discontinuous (label 5 of 6 slots ⇒ 1 tab + 5 regions), and the degrade without
 * it — a plain stack — loses no content and is obvious to debug.
 */
function isTab(slot: Slot): boolean {
  return Boolean(slot.placement?.tabLabel);
}

/**
 * Renders a ViewDescriptor. The layout mode selects the arrangement of slots.
 * `initialData` (optional) is a server-computed page-0 seed keyed by each table
 * populate's `${service}.${method}`; when present, usePagedRows renders those rows
 * on the first paint (SSR) and skips the initial client refetch on hydration.
 */
export function ViewRenderer({
  view,
  initialData,
}: {
  view: ViewDescriptor;
  initialData?: MeridianInitialData;
}): ReactNode {
  const sorted = [...view.slots].sort(byPosition);
  // Split the header-row slots out BEFORE the layout branch. `header_row` means
  // "render inline in the header row rather than as its own section" — the header
  // row is built right here, so this is the only place the split can hold for
  // tabbed AND twoColumn AND list/stacked alike.
  const headerRowSlots = sorted.filter(isHeaderRow);
  const slots = sorted.filter((s) => !isHeaderRow(s));
  const layout = view.layout?.mode;

  let body: ReactNode;
  switch (layout?.case) {
    case "tabbed":
      body = <TabbedSlots slots={slots} />;
      break;
    case "twoColumn":
      body = <TwoColumnSlots slots={slots} />;
      break;
    case "list":
    case "stacked":
    default:
      // list + stacked both render slots in order; a list view is just a
      // single-content-slot stack. Structural gap (kit-neutral) so stacked detail
      // panels (header / sections / related tables) don't butt together — parity
      // with the inline-styled twoColumn / tabbed branches.
      body = (
        <div className="mer-stack" style={{ display: "grid", gap: 24 }}>
          {slots.map((s) => (
            <SlotView key={s.id} slot={s} />
          ))}
        </div>
      );
  }

  // Header shows non-row actions; ROW actions go per-row in the table (below).
  const headerActions = view.actions.filter((a) => a.placement !== ActionPlacement.ROW);
  const rowActions = view.actions.filter((a) => a.placement === ActionPlacement.ROW);

  const rendered = (
    <div className="mer-view" data-view={view.id} data-kind={view.kind}>
      {/* Lay the header out as a row (title left, header-row slots + actions/kebab
          right) — kit-neutral inline style, matching the two-column/tabbed branches,
          so consumers don't have to style `mer-view-header` themselves (else title
          + actions stack). */}
      <header
        className="mer-view-header"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}
      >
        <h2 className="mer-view-title" style={{ margin: 0 }}>
          {view.title}
        </h2>
        {/* Placement.header_row slots ride the header row between the title and the
            actions. Rendered through SlotView like any other slot, so panel dispatch,
            data-slot/data-role and slot actions behave identically — only the
            position differs. `margin-left: auto` keeps them grouped with the actions
            on the right when the header wraps. */}
        {headerRowSlots.length > 0 ? (
          <div
            className="mer-view-header-slots"
            style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginLeft: "auto" }}
          >
            {headerRowSlots.map((s) => (
              <SlotView key={s.id} slot={s} />
            ))}
          </div>
        ) : null}
        <ActionsView actions={headerActions} />
      </header>
      {body}
    </div>
  );

  // Provide the per-row actions + the view subject to the kit's table (so no-call
  // actions can reach the host's onAction with the entity type), and the SSR seed
  // to the table hooks (no-op when undefined).
  const withRowActions = (
    <MeridianViewContext.Provider value={{ subjectKind: view.subjectKind, subjectId: view.subjectId }}>
      <MeridianRowActionsContext.Provider value={rowActions}>
        {rendered}
      </MeridianRowActionsContext.Provider>
    </MeridianViewContext.Provider>
  );
  return initialData ? (
    <MeridianInitialDataContext.Provider value={initialData}>
      {withRowActions}
    </MeridianInitialDataContext.Provider>
  ) : (
    withRowActions
  );
}

function TabbedSlots({ slots }: { slots: Slot[] }): ReactNode {
  const [active, setActive] = useState(0);
  // Partition: ONLY slots carrying a `tab_label` are tabs. Everything else is a
  // REGION — a normal section rendered ABOVE the strip in `position` order, which
  // is where a detail view's header and summary cards belong. Without this split
  // every slot became a tab, so the header card sat behind a tab labeled "header"
  // and the page had no header at all.
  //
  // `slots` arrives position-sorted and Array#sort is stable, so tabs sharing a
  // tab_position keep their relative position order.
  const tabs = [...slots].filter(isTab).sort(byTabPosition);
  const regions = slots.filter((s) => !isTab(s));
  // Clamp: the tab set is descriptor-derived and can shrink under the retained
  // `active` index (a descriptor swap), which would otherwise render an empty
  // body. -1 ⇒ no tabs at all (regions still render; the strip does not).
  const activeIndex = tabs.length > 0 ? Math.min(active, tabs.length - 1) : -1;

  return (
    <div className="mer-tabs">
      {regions.length > 0 ? (
        // Same kit-neutral structural gap as the `.mer-stack` branch — regions are
        // a stack that happens to sit above a tab strip.
        <div className="mer-tab-regions" style={{ display: "grid", gap: 24, marginBottom: 24 }}>
          {regions.map((s) => (
            <SlotView key={s.id} slot={s} />
          ))}
        </div>
      ) : null}
      {tabs.length > 0 ? (
        <>
          <div
            className="mer-tabstrip"
            role="tablist"
            // Structural + affordance styling (kit-neutral). Colors read the --mer-*
            // theme vars a kit exposes (MeridianMuiProvider / htmlKit set these),
            // falling back to sensible defaults so tabs look like tabs in any kit.
            style={{
              display: "flex",
              gap: 4,
              borderBottom: "1px solid var(--mer-border, #e0e0e0)",
              marginBottom: 16,
            }}
          >
            {tabs.map((s, i) => {
              const isActive = i === activeIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={isActive ? "mer-tab active" : "mer-tab"}
                  onClick={() => setActive(i)}
                  style={{
                    appearance: "none",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "8px 14px",
                    fontSize: 14,
                    fontFamily: "inherit",
                    color: isActive ? "var(--mer-accent, #1976d2)" : "var(--mer-fg, inherit)",
                    fontWeight: isActive ? 600 : 400,
                    borderBottom: isActive
                      ? "2px solid var(--mer-accent, #1976d2)"
                      : "2px solid transparent",
                    marginBottom: "-1px",
                  }}
                >
                  {/* isTab guarantees a non-empty tab_label — no title/id fallback.
                      Falling back to `id` is what rendered tabs literally labeled
                      "header" and "plan-year-selector". */}
                  {s.placement?.tabLabel}
                </button>
              );
            })}
          </div>
          {tabs[activeIndex] ? <SlotView slot={tabs[activeIndex]} /> : null}
        </>
      ) : null}
    </div>
  );
}

function TwoColumnSlots({ slots }: { slots: Slot[] }): ReactNode {
  // Column.COLUMN_SIDEBAR = 2; everything else (main / unspecified) is main.
  const sidebar = slots.filter((s) => s.placement?.column === 2);
  const main = slots.filter((s) => s.placement?.column !== 2);
  // Structural flex (kit-neutral): main + sidebar sit side by side, wrapping to
  // stacked on narrow viewports. Without this the columns would stack always.
  return (
    <div
      className="mer-two-column"
      style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <div className="mer-col-main" style={{ flex: "2 1 320px", minWidth: 0 }}>
        {main.map((s) => (
          <SlotView key={s.id} slot={s} />
        ))}
      </div>
      <aside className="mer-col-sidebar" style={{ flex: "1 1 240px", minWidth: 0 }}>
        {sidebar.map((s) => (
          <SlotView key={s.id} slot={s} />
        ))}
      </aside>
    </div>
  );
}
