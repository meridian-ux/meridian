// renderView — the composition/layout tier for the web-components renderer.
//
// Arranges a meridian.ui.v1 ViewDescriptor's slots per its Layout (list /
// stacked / tabbed / two-column) and delegates each slot's panel to renderPanel.
// The imperative-DOM counterpart of meridian-web-react's ViewRenderer: the
// layout is renderer-owned; the panels come from renderPanel.

import { toBinary } from "@bufbuild/protobuf";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type {
  Slot,
  ViewDescriptor,
} from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import {
  createAdmissionGate,
  type AdmissionGate,
  normalizeViewActions,
  type RpcInvoker,
} from "@savvifi/meridian-schemas/uiview";

import { disposePanel, plainValue, renderPanel } from "./renderer.js";
import { buildInvocationControl } from "./invocation_control.js";
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

// Runtime ownership only: a disposed/hidden slot cannot finish mounting a live
// resource or invoke a detached action. No transport state is serialized here.
interface SlotSession { active: boolean; panels: Set<HTMLElement>; views: Set<HTMLElement>; controls: Set<() => void> }
interface ViewSession { active: boolean; slots: Set<SlotSession>; budget: { used: number }; cost: number; depth: number; controls: Set<() => void> }
function ownViewCost(view: ViewDescriptor): number {
  let cost = 1 + view.slots.length + (view.affordances?.items.length ?? view.actions.length);
  for (const slot of view.slots) cost += slot.affordances?.items.length ?? slot.actions.length;
  return cost;
}
const VIEWS = new WeakMap<HTMLElement, ViewSession>();
const MAX_VIEW_NODES = 1000;
function viewCost(view: ViewDescriptor, depth = 0, ancestors = new Set<ViewDescriptor>()): number {
  if (depth > 64 || ancestors.has(view) || view.slots.length > MAX_VIEW_NODES) throw new Error("View composition limit exceeded.");
  ancestors.add(view);
  let cost = ownViewCost(view);
  try {
    for (const slot of view.slots) {
      if (slot.subView) cost += viewCost(slot.subView, depth + 1, ancestors);
      if (cost > MAX_VIEW_NODES) throw new Error("View composition limit exceeded.");
    }
    return cost;
  } finally { ancestors.delete(view); }
}
let nextViewId = 0;
function disposeSlot(session: SlotSession): void {
  session.active = false;
  for (const dispose of session.controls) dispose(); session.controls.clear();
  for (const view of session.views) disposeView(view);
  session.views.clear();
  for (const panel of session.panels) disposePanel(panel);
  session.panels.clear();
}
/** Release all panel resources and pending view observation before removing a
 * composed view. Idempotent; renderView calls this before replacing its root. */
export function disposeView(root: HTMLElement): void {
  const session = VIEWS.get(root);
  if (!session) return;
  VIEWS.delete(root);
  session.active = false;
  for (const dispose of session.controls) dispose(); session.controls.clear();
  session.budget.used -= session.cost;
  for (const slot of session.slots) disposeSlot(slot);
  session.slots.clear();
}

function gatedInvoker(
  invoker: RpcInvoker,
  gate: AdmissionGate,
  tier: "read" | "mutation",
): RpcInvoker {
  return {
    async invoke(service, method, request) {
      gate.check(tier, service, method);
      return invoker.invoke(service, method, request);
    },
  };
}

/** Renders a ViewDescriptor. The layout mode selects the arrangement of slots. */
export async function renderView(opts: RenderViewOptions): Promise<void> {
  return renderViewTree(opts, { used: 0 }, 0);
}

async function renderViewTree(opts: RenderViewOptions, budget: { used: number }, depth: number): Promise<void> {
  const gate = createAdmissionGate(opts.admission);
  const mutationInvoker = gatedInvoker(opts.invoker, gate, "mutation");
  const { root, view } = opts;
  disposeView(root);
  try {
    viewCost(view, depth);
    if (budget.used + ownViewCost(view) > MAX_VIEW_NODES) throw new Error("View composition limit exceeded.");
  } catch (reason) {
    const error = document.createElement("p"); error.setAttribute("role", "alert");
    error.textContent = reason instanceof Error ? reason.message : String(reason);
    root.replaceChildren(error); return;
  }
  const cost = ownViewCost(view);
  budget.used += cost;
  const session: ViewSession = { active: true, slots: new Set(), budget, cost, depth, controls: new Set() };
  VIEWS.set(root, session);
  root.innerHTML = "";
  root.classList.add("meridian-uiview-view");

  const header = document.createElement("header");
  header.className = "meridian-uiview-view-header";
  const title = document.createElement("h2");
  title.className = "meridian-uiview-view-title";
  title.textContent = view.title;
  header.appendChild(title);
  header.appendChild(buildActions(view, opts, () => session.active, dispose => session.controls.add(dispose)));
  root.appendChild(header);

  const sorted = [...view.slots].sort(
    (a, b) => (a.position || 0) - (b.position || 0),
  );
  for (const slot of sorted.filter(slot => slot.placement?.headerRow)) {
    await renderSlot(header, slot, opts, mutationInvoker, session);
    if (!session.active) return;
  }
  const slots = sorted.filter(slot => !slot.placement?.headerRow);
  const mode = view.layout?.mode;

  const container = document.createElement("div");
  container.className = "meridian-uiview-view-body";
  root.appendChild(container);

  if (mode?.case === "twoColumn") {
    container.classList.add("meridian-uiview-two-column");
    const main = document.createElement("div");
    main.className = "meridian-uiview-col-main";
    const side = document.createElement("aside");
    side.className = "meridian-uiview-col-sidebar";
    side.setAttribute("aria-label", "Sidebar");
    container.appendChild(main);
    container.appendChild(side);
    for (const slot of slots) {
      // Column.COLUMN_SIDEBAR = 2; everything else is main.
      await renderSlot(slot.placement?.column === 2 ? side : main, slot, opts, mutationInvoker, session);
      if (!session.active) return;
    }
    return;
  }

  if (mode?.case === "tabbed") {
    // Only labeled slots are tabs. Other regions remain visible above the
    // selector, in baseline position order, exactly like shared React views.
    for (const slot of slots.filter(slot => !slot.placement?.tabLabel)) {
      await renderSlot(container, slot, opts, mutationInvoker, session);
      if (!session.active) return;
    }
    const ordered = slots.filter(slot => slot.placement?.tabLabel).sort(
      (a, b) => (a.placement?.tabPosition || 0) - (b.placement?.tabPosition || 0),
    );
    if (!ordered.length) return;
    const id = `meridian-view-${++nextViewId}`;
    const tabSections: HTMLElement[] = [];
    const tabs = document.createElement("div");
    tabs.className = "meridian-uiview-tablist";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", `${view.title || view.id || "View"} sections`);
    container.appendChild(tabs);

    let selected = -1;
    let activeSlot: SlotSession | undefined;
    const focus = (index: number) => {
      for (const [i, button] of [...tabs.children].entries()) (button as HTMLElement).tabIndex = i === index ? 0 : -1;
      (tabs.children[index] as HTMLElement)?.focus();
    };
    const activate = async (index: number, moveFocus: boolean) => {
      if (!session.active) return;
      if (moveFocus) focus(index);
      if (selected === index) return;
      if (activeSlot) { disposeSlot(activeSlot); session.slots.delete(activeSlot); }
      if (selected >= 0) tabSections[selected].replaceChildren();
      selected = index;
      tabSections.forEach((panel, i) => {
        panel.hidden = i !== index;
        tabs.children[i].setAttribute("aria-selected", i === index ? "true" : "false");
      });
      activeSlot = { active: true, panels: new Set(), views: new Set(), controls: new Set() };
      await renderSlot(tabSections[index], ordered[index], opts, mutationInvoker, session, activeSlot);
    };

    for (const [index, slot] of ordered.entries()) {
      const section = document.createElement("div");
      container.appendChild(section);
      section.classList.add("meridian-uiview-tabpanel");
      section.setAttribute("role", "tabpanel");
      section.id = `${id}-panel-${index}`;
      section.setAttribute("aria-labelledby", `${id}-tab-${index}`);
      section.tabIndex = 0;
      section.hidden = index !== 0;
      tabSections.push(section);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "meridian-uiview-tab";
      button.textContent = slot.placement!.tabLabel;
      button.setAttribute("role", "tab");
      button.id = `${id}-tab-${index}`;
      button.setAttribute("aria-controls", section.id);
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      button.tabIndex = index === 0 ? 0 : -1;
      button.onfocus = () => { if (session.active) for (const tab of tabs.children) (tab as HTMLElement).tabIndex = tab === button ? 0 : -1; };
      button.onclick = () => { void activate(index, true); };
      button.onkeydown = (event) => {
        if (!session.active || event.altKey || event.ctrlKey || event.metaKey) return;
        let next = index;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); void activate(index, true); return;
        }
        if (event.key === "ArrowRight") next = (index + 1) % tabSections.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabSections.length) % tabSections.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabSections.length - 1;
        else return;
        event.preventDefault();
        focus(next);
      };
      tabs.appendChild(button);
    }
    tabs.addEventListener("focusout", event => {
      if (!tabs.contains(event.relatedTarget as Node | null))
        for (const [index, tab] of [...tabs.children].entries()) (tab as HTMLElement).tabIndex = index === selected ? 0 : -1;
    });
    await activate(0, false);
    return;
  }

  // list + stacked: slots rendered in position order.
  for (const slot of slots) {
    await renderSlot(container, slot, opts, mutationInvoker, session);
    if (!session.active) return;
  }
}

async function renderSlot(
  parent: HTMLElement,
  slot: Slot,
  opts: RenderViewOptions,
  mutationInvoker: RpcInvoker,
  session: ViewSession,
  mount: SlotSession = { active: true, panels: new Set(), views: new Set(), controls: new Set() },
): Promise<HTMLElement> {
  const section = document.createElement("section");
  const alive = () => session.active && mount.active;
  if (!alive()) return section;
  session.slots.add(mount);
  section.className = "meridian-uiview-slot";
  section.dataset.slot = slot.id;
  if (slot.role) section.dataset.role = slot.role;

  const panel = slot.panel;
  const label = slot.title || (!slot.subView ? panel?.title : undefined);
  if (label) {
    const h = document.createElement("h3");
    h.className = "meridian-uiview-slot-title";
    h.textContent = label;
    section.appendChild(h);
  }
  parent.appendChild(section);

  const dependency = slot.dependsOnSelectionKey;
  const selected = dependency && opts.context.selections ? Object.getOwnPropertyDescriptor(opts.context.selections, dependency) : undefined;
  if (dependency && (!selected || !("value" in selected) || !selected.value)) {
    section.dataset.awaitingSelection = dependency;
    const placeholder = document.createElement("p");
    placeholder.className = "meridian-uiview-slot-placeholder";
    placeholder.textContent = slot.dependsOnPlaceholder || "Make a selection to view this section.";
    section.append(placeholder); return section;
  }

  if (slot.subView) {
    const content = document.createElement("div"), status = document.createElement("p"), retry = document.createElement("button");
    section.append(content, status, retry);
    retry.type = "button"; retry.textContent = "Retry section"; retry.hidden = true;
    let loading = false;
    const sub = slot.subView;
    const load = async () => {
      if (!alive() || loading) return;
      loading = true; retry.hidden = true;
      status.setAttribute("role", "status"); status.textContent = "Loading…";
      for (const view of mount.views) disposeView(view);
      mount.views.clear(); content.replaceChildren();
      try {
        let records: Array<Record<string, unknown> | undefined> = [opts.record];
        if (slot.subViewPopulate) {
          const call = slot.subViewPopulate;
          createAdmissionGate(opts.admission).check("read", call.service, call.method);
          const request = plainValue(opts.wasm.buildRequest(toBinary(RpcCallSchema, call), opts.context)) as object;
          const response = await opts.invoker.invoke(call.service, call.method, request);
          if (!alive()) return;
          const found = opts.wasm.readPath(response, slot.subViewRowsField);
          const rows = found == null && Array.isArray(response) ? response : found;
          if (!Array.isArray(rows)) throw new Error("Repeated view response must contain a row array.");
          // Reject the entire repeated expansion before mounting any row. The
          // core's readPath bounds JSON conversion/output; this caps DOM expansion.
          if (rows.length * viewCost(sub, session.depth + 1) > MAX_VIEW_NODES - session.budget.used)
            throw new Error("View composition limit exceeded.");
          records = rows.map(row => {
            if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Repeated view rows must be objects.");
            return plainValue(opts.wasm.readPath(row, "")) as Record<string, unknown>;
          });
        }
        for (const [index, record] of records.entries()) {
          if (!alive()) return;
          const nested = document.createElement("div");
          if (slot.subViewPopulate) nested.dataset.subviewItem = String(index);
          content.append(nested); mount.views.add(nested);
          await renderViewTree({ ...opts, root: nested, view: sub, record,
            context: record === undefined ? opts.context : { ...opts.context, selectedRow: record } }, session.budget, session.depth + 1);
        }
        if (alive()) status.textContent = records.length ? "" : "No items.";
      } catch (reason) {
        if (alive()) {
          for (const view of mount.views) disposeView(view);
          mount.views.clear(); content.replaceChildren();
          status.setAttribute("role", "alert");
          status.textContent = `Could not load section: ${reason instanceof Error ? reason.message : String(reason)}`;
          retry.hidden = false;
        }
      } finally { loading = false; }
    };
    retry.onclick = () => { void load(); };
    await load();
    if (!alive()) return section;
  }

  if (!slot.subView && panel) {
    const panelRoot = document.createElement("div");
    section.appendChild(panelRoot);
    mount.panels.add(panelRoot);
    // Forward EVERY host seam (`view` is not a panel field, so it is dropped);
    // see the RenderViewOptions note on why this is a spread and not a list.
    const { view: _view, ...panelOpts } = opts;
    try {
      await renderPanel({ ...panelOpts, root: panelRoot, descriptor: panel,
        invoker: { invoke(service, method, request) {
          if (!alive()) return Promise.reject(new Error("View section is no longer active."));
          return opts.invoker.invoke(service, method, request);
        } },
        streamInvoker: opts.streamInvoker ? { subscribe(service, method, request, handlers) {
          if (!alive()) throw new Error("View section is no longer active.");
          return opts.streamInvoker!.subscribe(service, method, request, handlers);
        } } : undefined,
      });
    } catch (reason) {
      if (alive()) {
        const error = document.createElement("p"); error.setAttribute("role", "alert");
        error.textContent = `Could not render section: ${reason instanceof Error ? reason.message : String(reason)}`;
        panelRoot.append(error);
      }
    }
    if (!alive()) { disposePanel(panelRoot); return section; }
  }

  if ((slot.affordances?.items.length ?? slot.actions.length) > 0) {
    section.appendChild(buildActions(slot, opts, alive, dispose => mount.controls.add(dispose)));
  }
  return section;
}

// Resolve declared bindings at activation so retries use the current host context.
function buildActions(source: Pick<ViewDescriptor, "actions" | "affordances">, opts: RenderViewOptions, alive: () => boolean, onDispose: (dispose: () => void) => void): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "meridian-uiview-actions";
  for (const action of normalizeViewActions(source)) {
    bar.appendChild(buildInvocationControl({ ...opts, action, alive, onDispose,
      subject: { entityType: opts.view.subjectKind, entityId: opts.view.subjectId || undefined } }));
  }
  return bar;
}
