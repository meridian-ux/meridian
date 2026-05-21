// Meridian web renderer for PanelDescriptors.
//
// The Rust core (compiled to wasm via `wasm-pack build rust/uiview
// --features wasm`) handles all proto-walking, request building, and
// per-cell formatting. This TypeScript module wires JS-side DOM
// rendering on top of those wasm primitives, plus an `RpcInvoker`
// indirection so the host plugs in whatever transport it uses
// (Connect-ES, grpc-web, fetch against a REST gateway, mocked data
// for demos, …).
//
// Usage:
//
//   import init, { renderTable, buildPopulateRequest } from
//     '../../rust/uiview/pkg/meridian_uiview';
//   import { renderPanel } from '@meridian/core/uiview';
//
//   await init();
//   await renderPanel(rootEl, descriptor, invoker, context);

import {
  PanelDescriptor,
  RenderContext,
  RenderedRow,
  RpcInvoker,
} from './types.js';

/** Type-narrowed interface for the wasm bindings the renderer needs.
 *  Imported by the host; we don't ship the wasm in this package. */
export interface UiviewWasm {
  renderTable(descriptor: PanelDescriptor, response: object): RenderedRow[];
  buildPopulateRequest(
    descriptor: PanelDescriptor,
    context: RenderContext,
  ): object;
  readPath(value: object, path: string): unknown;
}

export interface RenderPanelOptions {
  /** Initialized wasm bindings (the host calls `init()` first). */
  wasm: UiviewWasm;
  /** Where to draw the panel. The renderer replaces the element's content. */
  root: HTMLElement;
  /** The panel to render. */
  descriptor: PanelDescriptor;
  /** Host transport for the populate / action RPCs. */
  invoker: RpcInvoker;
  /** Runtime context (active resource path, identity, form values). */
  context: RenderContext;
  /** Optional registry of adhoc handlers keyed by handler_id. */
  adhocFactories?: Record<string, (root: HTMLElement, descriptor: PanelDescriptor) => void>;
}

/**
 * Renders one panel into `root`. Async because the populate RPC has to
 * complete before we can draw the table; callers `await` to know when
 * the panel is interactive.
 */
export async function renderPanel(opts: RenderPanelOptions): Promise<void> {
  const { root, descriptor } = opts;
  root.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'meridian-uiview-header';
  header.textContent = descriptor.title;
  root.appendChild(header);

  const meta = document.createElement('div');
  meta.className = 'meridian-uiview-meta';
  meta.textContent = 'Loading…';
  root.appendChild(meta);

  if (descriptor.table) {
    await renderTablePanel(opts, meta);
    return;
  }
  if (descriptor.adhoc) {
    meta.textContent = '';
    const factory = opts.adhocFactories?.[descriptor.adhoc.handler_id];
    if (factory) {
      const slot = document.createElement('div');
      slot.className = 'meridian-uiview-body';
      root.appendChild(slot);
      factory(slot, descriptor);
    } else {
      const body = document.createElement('div');
      body.className = 'meridian-uiview-body';
      body.textContent = `Adhoc panel — handler_id: ${descriptor.adhoc.handler_id}`;
      root.appendChild(body);
    }
    return;
  }
  meta.textContent = '(no body set)';
}

async function renderTablePanel(
  opts: RenderPanelOptions,
  metaEl: HTMLElement,
): Promise<void> {
  const { wasm, root, descriptor, invoker, context } = opts;
  const table = descriptor.table!;
  const populate = table.populate;
  let response: object;
  try {
    const request = wasm.buildPopulateRequest(descriptor, context) as object;
    response = await invoker.invoke(populate.service, populate.method, request);
  } catch (err) {
    metaEl.textContent = `Failed: ${(err as Error).message}`;
    return;
  }
  const rows = wasm.renderTable(descriptor, response);
  metaEl.textContent = `${rows.length} ${table.item_noun ?? 'items'}`;

  const tableEl = document.createElement('table');
  tableEl.className = 'meridian-uiview-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const col of table.columns) {
    const th = document.createElement('th');
    th.textContent = col.header;
    if (col.pref_width) th.style.width = `${col.pref_width}px`;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  tableEl.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = table.columns.length;
    td.className = 'meridian-uiview-placeholder';
    td.textContent = table.placeholder ?? '(no rows)';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const cell of row.cells) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  tableEl.appendChild(tbody);
  root.appendChild(tableEl);
}
