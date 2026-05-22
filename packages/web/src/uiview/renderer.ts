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
  FormField,
  LroPanel,
  PanelDescriptor,
  RenderContext,
  RenderedRow,
  RpcCall,
  RpcInvoker,
  TablePanel,
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
  /** Generic primitives used by LRO + future panel shapes. */
  buildRequest(rpcCall: RpcCall, context: RenderContext): object;
  renderTablePanel(tablePanel: TablePanel, response: object): RenderedRow[];
  formatLroMetadata(metadata: object): string;
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
  if (descriptor.lro) {
    await renderLroPanel(opts, meta);
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

// ---------------------------------------------------------------------------
// LRO panel.
//
// Mirrors the JavaFX `DescribedLroCard` flow against the JSON-over-HTTP
// gateway: render a form, on submit POST the start RPC, then poll
// `google.longrunning.Operations/WaitOperation` until the Operation
// completes. If `panel.finalize` is set, the LRO response feeds a
// finalize RPC whose response becomes the result source; otherwise
// the LRO response itself is the source. The result is rendered using
// `panel.result` (a TablePanel).
//
// Anys (Operation.metadata, Operation.response) come back inline as
// `{ "@type": "...", ... }` because the gateway's JsonFormat is
// configured with a TypeRegistry. We strip the `@type` field before
// handing the value to the wasm renderer / formatter.
// ---------------------------------------------------------------------------

const LRO_MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes; matches JavaFX driver.
const LRO_POLL_WAIT_SECONDS = 5;            // Server-side wait per poll cycle.

async function renderLroPanel(
  opts: RenderPanelOptions,
  metaEl: HTMLElement,
): Promise<void> {
  const { root, descriptor } = opts;
  const panel = descriptor.lro!;

  metaEl.textContent = opts.context.currentResourcePath
    ? 'Click the button to run.'
    : 'No active resource.';

  // Form row.
  const formRow = document.createElement('div');
  formRow.style.display = 'flex';
  formRow.style.flexWrap = 'wrap';
  formRow.style.gap = '8px';
  formRow.style.padding = '4px 0';
  const formGetters: Record<string, () => unknown> = {};
  for (const field of panel.inputs ?? []) {
    formRow.appendChild(buildFormInput(field, formGetters));
  }
  if ((panel.inputs ?? []).length > 0) {
    root.appendChild(formRow);
  }

  // Action row + run button.
  const actionRow = document.createElement('div');
  actionRow.style.padding = '4px 0';
  const runButton = document.createElement('button');
  runButton.textContent = panel.run_button_label || 'Run';
  runButton.disabled = !opts.context.currentResourcePath;
  actionRow.appendChild(runButton);
  root.appendChild(actionRow);

  // Result area.
  const resultArea = document.createElement('div');
  if (panel.result) {
    const placeholder = document.createElement('div');
    placeholder.className = 'meridian-uiview-placeholder';
    placeholder.textContent =
      panel.result.placeholder ?? '(run to populate)';
    resultArea.appendChild(placeholder);
  }
  root.appendChild(resultArea);

  runButton.onclick = async () => {
    runButton.disabled = true;
    try {
      await driveLro({
        opts,
        metaEl,
        resultArea,
        panel,
        formValues: snapshotForm(formGetters),
      });
    } finally {
      runButton.disabled = false;
    }
  };
}

function buildFormInput(
  field: FormField,
  getters: Record<string, () => unknown>,
): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '4px';
  wrapper.style.fontSize = '13px';
  const labelText = document.createElement('span');
  labelText.textContent = field.label + ':';
  wrapper.appendChild(labelText);

  if (field.integer) {
    const input = document.createElement('input');
    input.type = 'number';
    input.style.width = '90px';
    if (field.integer.min !== undefined) input.min = String(field.integer.min);
    if (field.integer.max !== undefined && field.integer.max > 0) {
      input.max = String(field.integer.max);
    }
    if (field.integer.step !== undefined && field.integer.step > 0) {
      input.step = String(field.integer.step);
    }
    input.value = String(field.integer.default_value ?? 0);
    getters[field.field_id] = () => Number(input.value);
    wrapper.appendChild(input);
  } else if (field.text) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.text.default_value ?? '';
    getters[field.field_id] = () => input.value;
    wrapper.appendChild(input);
  }
  return wrapper;
}

function snapshotForm(
  getters: Record<string, () => unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, get] of Object.entries(getters)) out[k] = get();
  return out;
}

interface DriveLroArgs {
  opts: RenderPanelOptions;
  metaEl: HTMLElement;
  resultArea: HTMLElement;
  panel: LroPanel;
  formValues: Record<string, unknown>;
}

interface Operation {
  name: string;
  done?: boolean;
  metadata?: { ['@type']?: string;[k: string]: unknown };
  response?: { ['@type']?: string;[k: string]: unknown };
  error?: { code?: number; message?: string };
}

async function driveLro(args: DriveLroArgs): Promise<void> {
  const { opts, metaEl, resultArea, panel, formValues } = args;
  const { wasm, invoker, context } = opts;

  metaEl.textContent = 'Submitting…';
  const startCtx: RenderContext = { ...context, formValues };
  const startRequest = wasm.buildRequest(panel.start, startCtx);
  let op: Operation;
  try {
    op = (await invoker.invoke(
      panel.start.service,
      panel.start.method,
      startRequest,
    )) as Operation;
  } catch (err) {
    metaEl.textContent = `Failed: ${(err as Error).message}`;
    return;
  }

  const deadline = Date.now() + LRO_MAX_DURATION_MS;
  while (!op.done && Date.now() < deadline) {
    try {
      op = (await invoker.invoke(
        'google.longrunning.Operations',
        'WaitOperation',
        {
          name: op.name,
          timeout: { seconds: LRO_POLL_WAIT_SECONDS },
        },
      )) as Operation;
    } catch (err) {
      metaEl.textContent = `Poll failed: ${(err as Error).message}`;
      return;
    }
    if (op.metadata) {
      const metadata = stripAtType(op.metadata);
      metaEl.textContent = wasm.formatLroMetadata(metadata);
    }
  }
  if (!op.done) {
    metaEl.textContent = 'Timed out before completion.';
    return;
  }
  if (op.error) {
    metaEl.textContent = `Failed: ${op.error.message ?? '(no message)'}`;
    return;
  }

  // Pull the response into the format the result table expects.
  const lroResponse = op.response ? stripAtType(op.response) : {};
  let source: object = lroResponse;
  if (panel.finalize) {
    metaEl.textContent = `Running ${panel.finalize.method}…`;
    const finalizeCtx: RenderContext = {
      ...context,
      selectedRow: lroResponse,
      formValues,
    };
    const finalizeRequest = wasm.buildRequest(panel.finalize, finalizeCtx);
    try {
      source = (await invoker.invoke(
        panel.finalize.service,
        panel.finalize.method,
        finalizeRequest,
      )) as object;
    } catch (err) {
      metaEl.textContent = `Finalize failed: ${(err as Error).message}`;
      return;
    }
  }

  if (!panel.result) {
    metaEl.textContent = 'Done.';
    return;
  }
  const rows = wasm.renderTablePanel(panel.result, source);
  const noun = panel.result.item_noun ?? 'rows';
  metaEl.textContent = `Done · ${rows.length} ${noun}`;
  resultArea.innerHTML = '';
  resultArea.appendChild(buildResultTable(panel.result, rows));
}

function buildResultTable(
  result: TablePanel,
  rows: RenderedRow[],
): HTMLElement {
  const tableEl = document.createElement('table');
  tableEl.className = 'meridian-uiview-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const col of result.columns) {
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
    td.colSpan = result.columns.length;
    td.className = 'meridian-uiview-placeholder';
    td.textContent = result.placeholder ?? '(no rows)';
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
  return tableEl;
}

// JsonFormat with a TypeRegistry expands Anys as
//   { "@type": "type.googleapis.com/...", <fields> }
// The wasm renderers / formatters only care about the message fields,
// so we strip the discriminator before passing the object across.
function stripAtType(obj: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== '@type') clone[k] = v;
  }
  return clone;
}
