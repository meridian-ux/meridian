// Meridian web renderer for PanelDescriptors.
//
// The Rust core (meridian-uiview-core, compiled to wasm) handles all
// proto-walking, request building, and per-cell formatting. This TypeScript
// module wires JS-side DOM rendering on top of those wasm primitives, plus an
// `RpcInvoker` indirection so the host plugs in whatever transport it uses
// (Connect-ES, grpc-web, fetch against a REST gateway, mocked data for demos, …).
//
// The renderer speaks the CANONICAL protobuf-es types (@savvifi/meridian-proto-ts):
// it reads descriptor fields directly off the typed messages and serializes
// whole messages to protobuf BINARY (`toBinary`) when calling the wasm — which
// decodes them with prost. There is no JSON / snake_case DTO in between.

import { toBinary } from "@bufbuild/protobuf";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { RenderContext, RpcInvoker } from "@savvifi/meridian-schemas/uiview";

/** One rendered row as returned by the wasm `renderTable` call. */
export interface RenderedRow {
  raw: Record<string, unknown>;
  cells: string[];
}

/** Type-narrowed interface for the wasm bindings the renderer needs. Imported by
 *  the host; we don't ship the wasm in this package. Descriptors / sub-messages
 *  cross as protobuf binary (Uint8Array); responses + context are JSON. */
export interface UiviewWasm {
  renderTable(descriptor: Uint8Array, response: object): RenderedRow[];
  buildPopulateRequest(descriptor: Uint8Array, context: RenderContext): object;
  readPath(value: object, path: string): unknown;
  /** Generic primitives used by LRO + future panel shapes. */
  buildRequest(rpcCall: Uint8Array, context: RenderContext): object;
  renderTablePanel(tablePanel: Uint8Array, response: object): RenderedRow[];
  formatLroMetadata(metadata: object): string;
}

export interface RenderPanelOptions {
  /** Initialized wasm bindings (the host calls `init()` first). */
  wasm: UiviewWasm;
  /** Where to draw the panel. The renderer replaces the element's content. */
  root: HTMLElement;
  /** The panel to render (canonical meridian.ui.v1.PanelDescriptor). */
  descriptor: PanelDescriptor;
  /** Host transport for the populate / action RPCs. */
  invoker: RpcInvoker;
  /** Runtime context (active resource path, identity, form values). */
  context: RenderContext;
  /** Optional registry of adhoc handlers keyed by handler_id. */
  adhocFactories?: Record<
    string,
    (root: HTMLElement, descriptor: PanelDescriptor) => void
  >;
}

/**
 * Renders one panel into `root`. Async because the populate RPC has to complete
 * before we can draw the table; callers `await` to know when the panel is
 * interactive.
 */
export async function renderPanel(opts: RenderPanelOptions): Promise<void> {
  const { root, descriptor } = opts;
  root.innerHTML = "";
  const header = document.createElement("div");
  header.className = "meridian-uiview-header";
  header.textContent = descriptor.title;
  root.appendChild(header);

  const meta = document.createElement("div");
  meta.className = "meridian-uiview-meta";
  meta.textContent = "Loading…";
  root.appendChild(meta);

  const body = descriptor.body;
  if (body.case === "table") {
    await renderTablePanel(opts, body.value, meta);
    return;
  }
  if (body.case === "lro") {
    await renderLroPanel(opts, body.value, meta);
    return;
  }
  if (body.case === "adhoc") {
    meta.textContent = "";
    const factory = opts.adhocFactories?.[body.value.handlerId];
    const slot = document.createElement("div");
    slot.className = "meridian-uiview-body";
    root.appendChild(slot);
    if (factory) {
      factory(slot, descriptor);
    } else {
      slot.textContent = `Adhoc panel — handler_id: ${body.value.handlerId}`;
    }
    return;
  }
  meta.textContent = "(no body set)";
}

async function renderTablePanel(
  opts: RenderPanelOptions,
  table: TablePanel,
  metaEl: HTMLElement,
): Promise<void> {
  const { wasm, root, descriptor, invoker } = opts;
  const populate = table.populate;
  if (!populate) {
    metaEl.textContent = "(table has no populate RPC)";
    return;
  }
  const descriptorBytes = toBinary(PanelDescriptorSchema, descriptor);
  let response: object;
  try {
    const request = wasm.buildPopulateRequest(descriptorBytes, opts.context);
    response = await invoker.invoke(populate.service, populate.method, request);
  } catch (err) {
    metaEl.textContent = `Failed: ${(err as Error).message}`;
    return;
  }
  const rows = wasm.renderTable(descriptorBytes, response);
  metaEl.textContent = `${rows.length} ${table.itemNoun || "items"}`;
  root.appendChild(buildTable(table, rows));
}

function buildTable(table: TablePanel, rows: RenderedRow[]): HTMLElement {
  const tableEl = document.createElement("table");
  tableEl.className = "meridian-uiview-table";
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  for (const col of table.columns) {
    const th = document.createElement("th");
    th.textContent = col.header;
    if (col.prefWidth) th.style.width = `${col.prefWidth}px`;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  tableEl.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = table.columns.length;
    td.className = "meridian-uiview-placeholder";
    td.textContent = table.placeholder || "(no rows)";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const cell of row.cells) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  tableEl.appendChild(tbody);
  return tableEl;
}

// ---------------------------------------------------------------------------
// LRO panel.
//
// Mirrors the JavaFX `DescribedLroCard` flow against the JSON-over-HTTP gateway:
// render a form, on submit POST the start RPC, then poll
// `google.longrunning.Operations/WaitOperation` until the Operation completes.
// If `finalize` is set, the LRO response feeds a finalize RPC whose response
// becomes the result source; otherwise the LRO response itself is the source.
// The result is rendered using `result` (a TablePanel).
//
// Anys (Operation.metadata, Operation.response) come back inline as
// `{ "@type": "...", ... }`; we strip `@type` before handing the value across.
// ---------------------------------------------------------------------------

const LRO_MAX_DURATION_MS = 30 * 60 * 1000; // 30 minutes; matches JavaFX driver.
const LRO_POLL_WAIT_SECONDS = 5; // Server-side wait per poll cycle.

async function renderLroPanel(
  opts: RenderPanelOptions,
  panel: LroPanel,
  metaEl: HTMLElement,
): Promise<void> {
  const { root } = opts;

  metaEl.textContent = opts.context.currentResourcePath
    ? "Click the button to run."
    : "No active resource.";

  // Form row.
  const formRow = document.createElement("div");
  formRow.style.display = "flex";
  formRow.style.flexWrap = "wrap";
  formRow.style.gap = "8px";
  formRow.style.padding = "4px 0";
  const formGetters: Record<string, () => unknown> = {};
  for (const field of panel.inputs) {
    formRow.appendChild(buildFormInput(field, formGetters));
  }
  if (panel.inputs.length > 0) {
    root.appendChild(formRow);
  }

  // Action row + run button.
  const actionRow = document.createElement("div");
  actionRow.style.padding = "4px 0";
  const runButton = document.createElement("button");
  runButton.textContent = panel.runButtonLabel || "Run";
  runButton.disabled = !opts.context.currentResourcePath;
  actionRow.appendChild(runButton);
  root.appendChild(actionRow);

  // Result area.
  const resultArea = document.createElement("div");
  if (panel.result) {
    const placeholder = document.createElement("div");
    placeholder.className = "meridian-uiview-placeholder";
    placeholder.textContent = panel.result.placeholder || "(run to populate)";
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
  const wrapper = document.createElement("label");
  wrapper.style.display = "inline-flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "4px";
  wrapper.style.fontSize = "13px";
  const labelText = document.createElement("span");
  labelText.textContent = field.label + ":";
  wrapper.appendChild(labelText);

  const kind = field.kind;
  if (kind.case === "integer") {
    const spec = kind.value;
    const input = document.createElement("input");
    input.type = "number";
    input.style.width = "90px";
    input.min = String(spec.min);
    if (spec.max > 0) input.max = String(spec.max);
    if (spec.step > 0) input.step = String(spec.step);
    input.value = String(spec.defaultValue);
    getters[field.fieldId] = () => Number(input.value);
    wrapper.appendChild(input);
  } else if (kind.case === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = kind.value.defaultValue;
    getters[field.fieldId] = () => input.value;
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
  metadata?: { ["@type"]?: string; [k: string]: unknown };
  response?: { ["@type"]?: string; [k: string]: unknown };
  error?: { code?: number; message?: string };
}

function bytesForRpc(call: RpcCall): Uint8Array {
  return toBinary(RpcCallSchema, call);
}

async function driveLro(args: DriveLroArgs): Promise<void> {
  const { opts, metaEl, resultArea, panel, formValues } = args;
  const { wasm, invoker, context } = opts;

  const start = panel.start;
  if (!start) {
    metaEl.textContent = "(LRO has no start RPC)";
    return;
  }

  metaEl.textContent = "Submitting…";
  const startCtx: RenderContext = { ...context, formValues };
  const startRequest = wasm.buildRequest(bytesForRpc(start), startCtx);
  let op: Operation;
  try {
    op = (await invoker.invoke(
      start.service,
      start.method,
      startRequest,
    )) as Operation;
  } catch (err) {
    metaEl.textContent = `Failed: ${(err as Error).message}`;
    return;
  }

  const deadline = Date.now() + LRO_MAX_DURATION_MS;
  while (!op.done && Date.now() < deadline) {
    try {
      op = (await invoker.invoke("google.longrunning.Operations", "WaitOperation", {
        name: op.name,
        timeout: { seconds: LRO_POLL_WAIT_SECONDS },
      })) as Operation;
    } catch (err) {
      metaEl.textContent = `Poll failed: ${(err as Error).message}`;
      return;
    }
    if (op.metadata) {
      metaEl.textContent = wasm.formatLroMetadata(stripAtType(op.metadata));
    }
  }
  if (!op.done) {
    metaEl.textContent = "Timed out before completion.";
    return;
  }
  if (op.error) {
    metaEl.textContent = `Failed: ${op.error.message ?? "(no message)"}`;
    return;
  }

  // Pull the response into the format the result table expects.
  const lroResponse = op.response ? stripAtType(op.response) : {};
  let source: object = lroResponse;
  const finalize = panel.finalize;
  if (finalize) {
    metaEl.textContent = `Running ${finalize.method}…`;
    const finalizeCtx: RenderContext = {
      ...context,
      selectedRow: lroResponse,
      formValues,
    };
    const finalizeRequest = wasm.buildRequest(bytesForRpc(finalize), finalizeCtx);
    try {
      source = (await invoker.invoke(
        finalize.service,
        finalize.method,
        finalizeRequest,
      )) as object;
    } catch (err) {
      metaEl.textContent = `Finalize failed: ${(err as Error).message}`;
      return;
    }
  }

  const result = panel.result;
  if (!result) {
    metaEl.textContent = "Done.";
    return;
  }
  const rows = wasm.renderTablePanel(toBinary(TablePanelSchema, result), source);
  metaEl.textContent = `Done · ${rows.length} ${result.itemNoun || "rows"}`;
  resultArea.innerHTML = "";
  resultArea.appendChild(buildTable(result, rows));
}

// JsonFormat with a TypeRegistry expands Anys as
//   { "@type": "type.googleapis.com/...", <fields> }
// The wasm renderers / formatters only care about the message fields, so we
// strip the discriminator before passing the object across.
function stripAtType(obj: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== "@type") clone[k] = v;
  }
  return clone;
}
