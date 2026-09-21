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
import {
  createAdmissionGate,
  type AdmissionGate,
  type RpcInvoker,
  type StreamInvoker,
} from "@savvifi/meridian-schemas/uiview";

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

function gatedInvoker(
  invoker: RpcInvoker,
  gate: AdmissionGate,
  tier: "read" | "mutation",
): RpcInvoker {
  return {
    invoke(service, method, request) {
      gate.check(tier, service, method);
      return invoker.invoke(service, method, request);
    },
  };
}

function gatedStreamInvoker(
  invoker: StreamInvoker,
  gate: AdmissionGate,
): StreamInvoker {
  return {
    subscribe(service, method, request, handlers) {
      gate.check("read", service, method);
      return invoker.subscribe(service, method, request, handlers);
    },
  };
}

/** Renders a ViewDescriptor. The layout mode selects the arrangement of slots. */
export async function renderView(opts: RenderViewOptions): Promise<void> {
  const gate = createAdmissionGate(opts.admission);
  const invoker = gatedInvoker(opts.invoker, gate, "read");
  const mutationInvoker = gatedInvoker(opts.invoker, gate, "mutation");
  const guardedOpts: RenderViewOptions = {
    ...opts,
    invoker,
    mutationInvoker,
    streamInvoker: opts.streamInvoker
      ? gatedStreamInvoker(opts.streamInvoker, gate)
      : undefined,
  };
  const { root, view } = guardedOpts;
  root.innerHTML = "";
  root.className = "meridian-uiview-view";

  const header = document.createElement("header");
  header.className = "meridian-uiview-view-header";
  const title = document.createElement("h2");
  title.className = "meridian-uiview-view-title";
  title.textContent = view.title;
  header.appendChild(title);
  header.appendChild(buildActions(view.actions, mutationInvoker));
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
      await renderSlot(slot.placement?.column === 2 ? side : main, slot, guardedOpts);
    }
    return;
  }

  if (mode?.case === "tabbed") {
    const ordered = [...slots].sort(
      (a, b) => (a.placement?.tabPosition || 0) - (b.placement?.tabPosition || 0),
    );
    const tabSections: HTMLElement[] = [];
    const tabs = document.createElement("div");
    tabs.className = "meridian-uiview-tablist";
    tabs.setAttribute("role", "tablist");
    container.appendChild(tabs);

    for (const [index, slot] of ordered.entries()) {
      const section = await renderSlot(container, slot, guardedOpts);
      section.classList.add("meridian-uiview-tabpanel");
      section.setAttribute("role", "tabpanel");
      section.id = `meridian-uiview-tabpanel-${slot.id}`;
      tabSections.push(section);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "meridian-uiview-tab";
      button.textContent = slot.placement?.tabLabel || slot.title || slot.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", section.id);
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      button.tabIndex = index === 0 ? 0 : -1;
      const activate = (nextIndex: number) => {
        tabSections.forEach((panel, panelIndex) => {
          const active = panelIndex === nextIndex;
          panel.hidden = !active;
          const tab = tabs.children[panelIndex] as HTMLElement | undefined;
          tab?.setAttribute("aria-selected", active ? "true" : "false");
          if (tab) tab.tabIndex = active ? 0 : -1;
        });
        (tabs.children[nextIndex] as HTMLButtonElement | undefined)?.focus();
      };
      button.onclick = () => activate(index);
      button.onkeydown = (event) => {
        if (!tabSections.length) return;
        let next = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabSections.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabSections.length) % tabSections.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabSections.length - 1;
        else return;
        event.preventDefault();
        activate(next);
      };
      tabs.appendChild(button);
    }
    tabSections.forEach((section, index) => { section.hidden = index !== 0; });
    return;
  }

  // list + stacked: slots rendered in position order.
  for (const slot of slots) {
    await renderSlot(container, slot, guardedOpts);
  }
}

async function renderSlot(
  parent: HTMLElement,
  slot: Slot,
  opts: RenderViewOptions,
): Promise<HTMLElement> {
  const section = document.createElement("section");
  section.className = "meridian-uiview-slot";
  section.dataset.slot = slot.id;
  if (slot.role) section.dataset.role = slot.role;

  const panel = slot.panel;
  const label = slot.title || panel?.title;
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
    section.appendChild(buildActions(slot.actions, opts.mutationInvoker ?? opts.invoker));
  }
  return section;
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
      if (a.call) {
        void invoker.invoke(a.call.service, a.call.method, {}).catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          btn.dataset.error = reason;
          btn.title = reason;
        });
      }
    };
    bar.appendChild(btn);
  }
  return bar;
}
