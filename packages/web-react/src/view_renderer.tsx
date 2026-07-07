// ViewRenderer — the composition/layout tier of the React renderer.
//
// Renders a meridian.ui.v1 ViewDescriptor: applies the Layout (list / stacked /
// tabbed / two-column), delegates each Slot's panel to PanelRenderer (so the
// kit-agnostic panel dispatch is reused), and renders view- and slot-level
// Actions via the invoker. The layout STRUCTURE is kit-agnostic; the panels and
// the action affordances come from the active ComponentKit.

import { useState } from "react";
import type { ReactNode } from "react";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type {
  Action,
  Slot,
  ViewDescriptor,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { PanelRenderer } from "./panel_renderer.js";
import { useMeridian } from "./provider.js";
import { MeridianInitialDataContext, type MeridianInitialData } from "./pagination.js";

// Fire an action's RpcCall. Binding resolution (row/form context → request
// fields) is a later increment; the first cut fires with an empty request and
// lets the invoker/backend supply defaults.
function fireAction(invoker: RpcInvoker, action: Action): void {
  if (action.call) {
    void invoker.invoke(action.call.service, action.call.method, {});
  }
}

function ActionsView({ actions }: { actions: Action[] }): ReactNode {
  const { kit, invoker } = useMeridian();
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
          onClick={() => fireAction(invoker, a)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// One slot: an optional title, the panel, and any slot (row) actions.
function SlotView({ slot }: { slot: Slot }): ReactNode {
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
  const slots = [...view.slots].sort(byPosition);
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
      // single-content-slot stack.
      body = (
        <div className="mer-stack">
          {slots.map((s) => (
            <SlotView key={s.id} slot={s} />
          ))}
        </div>
      );
  }

  const rendered = (
    <div className="mer-view" data-view={view.id} data-kind={view.kind}>
      <header className="mer-view-header">
        <h2 className="mer-view-title">{view.title}</h2>
        <ActionsView actions={view.actions} />
      </header>
      {body}
    </div>
  );

  // Provide the SSR seed to the table hooks below (no-op when undefined).
  return initialData ? (
    <MeridianInitialDataContext.Provider value={initialData}>
      {rendered}
    </MeridianInitialDataContext.Provider>
  ) : (
    rendered
  );
}

function TabbedSlots({ slots }: { slots: Slot[] }): ReactNode {
  const [active, setActive] = useState(0);
  const ordered = [...slots].sort(
    (a, b) => (a.placement?.tabPosition || 0) - (b.placement?.tabPosition || 0),
  );
  return (
    <div className="mer-tabs">
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
        {ordered.map((s, i) => {
          const isActive = i === active;
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
              {s.placement?.tabLabel || s.title || s.id}
            </button>
          );
        })}
      </div>
      {ordered[active] ? <SlotView slot={ordered[active]} /> : null}
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
