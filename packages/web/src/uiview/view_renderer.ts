// renderView — the composition/layout tier for the web-components renderer.
//
// Arranges a meridian.ui.v1 ViewDescriptor's slots per its Layout (list /
// stacked / tabbed / two-column) and delegates each slot's panel to renderPanel.
// The imperative-DOM counterpart of meridian-web-react's ViewRenderer: the
// layout is renderer-owned; the panels come from renderPanel.

import type {
  Action,
  Slot,
  ViewDescriptor,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { renderPanel } from "./renderer.js";
import type { RenderPanelOptions } from "./renderer.js";

/**
 * Options for {@link renderView}.
 *
 * Derived from `RenderPanelOptions` minus the per-panel fields (`root`,
 * `descriptor`) rather than re-declared, so EVERY host seam a panel can take is
 * carried here and forwarded to every slot. That is load-bearing: this used to
 * list a subset, so `renderSlot` called `renderPanel` without `renderGrammar` /
 * `renderIcon` and a chart inside a view silently degraded to alt text — which
 * is most dashboards (PRIMITIVES-NEXT §2b). Adding a seam to a panel now reaches
 * views for free instead of needing a second edit here.
 */
export type RenderViewOptions = Omit<
  RenderPanelOptions,
  "root" | "descriptor"
> & {
  /** Where to draw the view. The renderer replaces the element's content. */
  root: HTMLElement;
  /** The view to render (canonical meridian.ui.v1.ViewDescriptor). */
  view: ViewDescriptor;
};

/** Renders a ViewDescriptor. The layout mode selects the arrangement of slots. */
export async function renderView(opts: RenderViewOptions): Promise<void> {
  const { root, view, invoker } = opts;
  root.innerHTML = "";
  root.className = "meridian-uiview-view";

  const header = document.createElement("header");
  header.className = "meridian-uiview-view-header";
  const title = document.createElement("h2");
  title.className = "meridian-uiview-view-title";
  title.textContent = view.title;
  header.appendChild(title);
  header.appendChild(buildActions(view.actions, invoker));
  root.appendChild(header);

  const slots = [...view.slots].sort(
    (a, b) => (a.position || 0) - (b.position || 0),
  );
  const mode = view.layout?.mode;

  const container = document.createElement("div");
  container.className = "meridian-uiview-view-body";
  root.appendChild(container);

  if (mode?.case === "twoColumn") {
    const main = document.createElement("div");
    main.className = "meridian-uiview-col-main";
    const side = document.createElement("aside");
    side.className = "meridian-uiview-col-sidebar";
    container.appendChild(main);
    container.appendChild(side);
    for (const slot of slots) {
      // Column.COLUMN_SIDEBAR = 2; everything else is main.
      await renderSlot(slot.placement?.column === 2 ? side : main, slot, opts);
    }
    return;
  }

  if (mode?.case === "tabbed") {
    // First cut: render each tab labeled + stacked (a non-interactive
    // representation; an interactive web-components tab strip is a follow-up).
    const ordered = [...slots].sort(
      (a, b) => (a.placement?.tabPosition || 0) - (b.placement?.tabPosition || 0),
    );
    for (const slot of ordered) {
      await renderSlot(container, slot, opts, slot.placement?.tabLabel);
    }
    return;
  }

  // list + stacked: slots rendered in position order.
  for (const slot of slots) {
    await renderSlot(container, slot, opts);
  }
}

async function renderSlot(
  parent: HTMLElement,
  slot: Slot,
  opts: RenderViewOptions,
  tabLabel?: string,
): Promise<void> {
  const section = document.createElement("section");
  section.className = "meridian-uiview-slot";
  section.dataset.slot = slot.id;
  if (slot.role) section.dataset.role = slot.role;

  const panel = slot.panel;
  const label = tabLabel || slot.title || panel?.title;
  if (label) {
    const h = document.createElement("h3");
    h.className = "meridian-uiview-slot-title";
    h.textContent = label;
    section.appendChild(h);
  }
  parent.appendChild(section);

  if (panel) {
    const panelRoot = document.createElement("div");
    section.appendChild(panelRoot);
    // Forward EVERY host seam (`view` is not a panel field, so it is dropped);
    // see the RenderViewOptions note on why this is a spread and not a list.
    const { view: _view, ...panelOpts } = opts;
    await renderPanel({ ...panelOpts, root: panelRoot, descriptor: panel });
  }

  if (slot.actions && slot.actions.length > 0) {
    section.appendChild(buildActions(slot.actions, opts.invoker));
  }
}

// Actions render as buttons; binding resolution (row/form → request) is a later
// increment, so the first cut fires with an empty request.
function buildActions(actions: Action[], invoker: RpcInvoker): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "meridian-uiview-actions";
  for (const a of actions || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = a.label;
    btn.onclick = () => {
      if (a.call) void invoker.invoke(a.call.service, a.call.method, {});
    };
    bar.appendChild(btn);
  }
  return bar;
}
