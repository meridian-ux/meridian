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
import type { Affordance, ActionPanel } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { AffordanceStyle } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { CatalogPanel } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import type { ChoicePanel } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import type { ConnectFlowPanel } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import type { CopyValue, CopyValuePanel } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { GrammarPanel } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import type {
  DetailHeaderPanel,
  FormPanel,
  PanelDescriptor,
  RecordCardPanel,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import type { Snippet, SnippetPanel } from "@savvifi/meridian-proto-ts/proto/snippet_pb.js";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import type { StreamPanel } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { FollowMode } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import type { TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type {
  RenderContext,
  RpcInvoker,
  StreamInvoker,
} from "@savvifi/meridian-schemas/uiview";
import { computeStat, statSparklinePoints, trendArrow } from "@savvifi/meridian-schemas/uiview";

import { renderTerminalPanel } from "../terminal_panel.js";

/** One rendered row as returned by the wasm `renderTable` call. */
export interface RenderedRow {
  raw: Record<string, unknown>;
  cells: string[];
}

/**
 * Normalize a row's `raw` to a plain object.
 *
 * The wasm core serializes `raw` with serde-wasm-bindgen, whose DEFAULT maps a
 * `serde_json::Value::Object` to a JS **Map**, not an object. So `raw.name` is
 * `undefined` while `raw.get("name")` works — silently, with no error anywhere.
 * That shipped a real bug: `ColumnLink`'s `resolveHref` read `row[idField]`, got
 * undefined, fell back to the displayed cell value, and every build link in the
 * fastverk console pointed at a repo name instead of a build id.
 *
 * Normalizing HERE rather than upstream is deliberate: this renderer has to work
 * against a range of core versions, so it must accept either shape regardless of
 * what the core does next. (The upstream cleanup — `serialize_maps_as_objects` —
 * is still worth doing; this stops depending on it.)
 *
 * Shallow by design: `field_path` resolution goes through the wasm's `readPath`,
 * which takes the value back across the boundary. Only the top level is read
 * directly by hosts.
 */
function plainRow(raw: unknown): Record<string, unknown> {
  return plainValue(raw) as Record<string, unknown>;
}

/**
 * Deeply convert serde-wasm-bindgen's Maps to plain objects.
 *
 * Everything the wasm returns as a `serde_json::Value::Object` arrives as a JS
 * `Map` — not just table rows, but the REQUESTS built by `buildRequest` /
 * `buildPopulateRequest`. That is the more damaging case, because a request is
 * handed straight to the host's `RpcInvoker` and hosts do the obvious things
 * with it:
 *
 *     JSON.stringify(new Map([["name", "x"]]))  === "{}"
 *     Object.entries(new Map([["name", "x"]]))  === []
 *
 * So every binding-populated request silently serialized to NOTHING — a bound
 * GET sent no query params and a bound POST sent an empty body. Observed in the
 * fastverk console: a build's log stream subscribed to `?` with no build name,
 * and every per-build table came back empty because the id never left the page.
 *
 * Deep, not shallow: `NestedBinding` builds sub-objects, so an un-normalized
 * nested Map would break the same way one level down.
 */
function plainValue(v: unknown): unknown {
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of v) out[String(k)] = plainValue(val);
    return out;
  }
  if (Array.isArray(v)) return v.map(plainValue);
  return v ?? {};
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
  /**
   * Host transport for SERVER-STREAMING methods — what a StreamPanel subscribes
   * through. Optional: streaming is a surface capability, not a given, and a
   * host without it degrades the panel to its placeholder (stream.proto).
   */
  streamInvoker?: StreamInvoker;
  /** Runtime context (active resource path, identity, form values). */
  context: RenderContext;
  /** Optional registry of adhoc handlers keyed by handler_id. */
  adhocFactories?: Record<
    string,
    (root: HTMLElement, descriptor: PanelDescriptor) => void
  >;
  /**
   * Host glyph resolver for the content shapes' `icon` keys (ChoiceOption.icon,
   * Affordance.icon, ConnectTarget.icon, CatalogItem.icon). Returns an
   * HTMLElement to inline as the glyph. Absent ⇒ no glyph is drawn but the key
   * still lands on `data-icon`, so it is never dropped (host CSS can resolve it).
   */
  renderIcon?: (key: string) => HTMLElement | undefined;
  /**
   * Host route resolver for a `ColumnLink` cell — the link peer of renderIcon /
   * renderGrammar. Meridian never builds a URL: it hands the host the target
   * kind, the cell's value (the entity id) and the raw row, and the host maps
   * that to its own route. Absent, or returning nothing ⇒ plain text, never a
   * dead link.
   */
  resolveHref?: (opts: {
    targetKind: string;
    id: string;
    row?: object;
  }) => string | null | undefined;
  /**
   * Host renderer for a GrammarPanel — a declarative grammar (markdown / mermaid
   * / plantuml / vega). The descriptor names the `language` + `source`; the host
   * wires the actual library (mermaid.render, vega-embed, a markdown parser) and
   * returns an HTMLElement to mount. Absent (or returns nothing) ⇒ the renderer
   * falls back to the source in a `<pre>`. The kit itself imports no grammar lib.
   */
  renderGrammar?: (opts: {
    language: string;
    source: string;
    data?: unknown;
  }) => HTMLElement | undefined;
}

// ---------------------------------------------------------------------------
// Panel teardown.
//
// Most shapes are inert DOM: clearing the container is a complete teardown. Two
// are NOT — TerminalPanel holds a WebSocket and StreamPanel holds a
// subscription — and a live connection is not released by dropping the element
// that displays it. Before this, re-rendering a container over a terminal
// leaked its socket (the TerminalHandle's disposer was returned and discarded).
//
// So a panel that acquires a resource registers a disposer against its
// container; `renderPanel` runs them before drawing anything new, and the seam's
// `unmount` runs them via `disposePanel`. Idempotent by construction: the list
// is cleared as it runs.
// ---------------------------------------------------------------------------

const DISPOSERS = new WeakMap<HTMLElement, Array<() => void>>();

function onDispose(root: HTMLElement, dispose: () => void): void {
  const list = DISPOSERS.get(root);
  if (list) list.push(dispose);
  else DISPOSERS.set(root, [dispose]);
}

/**
 * Release any live resources a panel rendered into `root` holds (a terminal's
 * socket, a stream's subscription), without touching the DOM. Called by
 * `renderPanel` before a re-render and by the seam's `unmount`.
 */
export function disposePanel(root: HTMLElement): void {
  const list = DISPOSERS.get(root);
  if (!list) return;
  DISPOSERS.delete(root);
  for (const dispose of list) {
    try {
      dispose();
    } catch {
      // A failing disposer must not strand the others.
    }
  }
}

/**
 * Renders one panel into `root`. Async because the populate RPC has to complete
 * before we can draw the table; callers `await` to know when the panel is
 * interactive.
 */
export async function renderPanel(opts: RenderPanelOptions): Promise<void> {
  const { root, descriptor } = opts;
  disposePanel(root);
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
  if (body.case === "form") {
    meta.textContent = "";
    root.appendChild(buildForm(body.value));
    return;
  }
  // TerminalPanel — an xterm.js terminal over a pty WebSocket. WEB-SPECIFIC.
  // Canonical at schemas 0.5.0 (proto/terminal.proto), so `terminal` is now a
  // first-class oneof case (no cast, no local shape). See terminal_panel.ts.
  if (body.case === "terminal") {
    meta.textContent = "";
    const spec = body.value;
    const slot = document.createElement("div");
    slot.className = "meridian-uiview-body";
    root.appendChild(slot);
    const handle = renderTerminalPanel(slot, {
      url: fillTemplate(spec.url, opts.context),
      tool: spec.tool,
      cols: spec.cols,
      rows: spec.rows,
    });
    // The handle owns a live WebSocket; without this it outlived the panel.
    onDispose(root, () => handle.dispose());
    return;
  }
  // GrammarPanel — a declarative grammar (markdown / mermaid / plantuml / vega).
  // The host wires the per-language renderers via renderGrammar (mermaid, vega-
  // embed, a markdown lib); this kit stays grammar-lib-free and falls back to the
  // source in a <pre>.
  if (body.case === "grammar") {
    meta.textContent = "";
    root.appendChild(buildGrammar(opts, body.value));
    return;
  }
  // StatPanel — a KPI tile. Full-parity content shape; delta/trend/formatting via
  // the shared computeStat (identical to the other renderers).
  if (body.case === "stat") {
    meta.textContent = "";
    root.appendChild(buildStat(body.value));
    return;
  }
  // StreamPanel — an append-only line stream (a build log, a deploy log, an
  // agent transcript). The host supplies the transport via `streamInvoker`;
  // absent, we degrade to the placeholder rather than blanking. See stream.proto.
  if (body.case === "stream") {
    return renderStreamPanel(opts, body.value, meta);
  }
  // DetailHeaderPanel / RecordCardPanel — the two RECORD-BOUND bodies of a detail
  // view. Both fetch ONE record via `populate`, binding the view's subject into
  // `id_field`, then read dotted paths out of it. They share that tier, so they
  // share an implementation here. See panel.proto.
  if (body.case === "detailHeader") {
    return renderRecordPanel(opts, body.value, meta, "header");
  }
  if (body.case === "recordCard") {
    return renderRecordPanel(opts, body.value, meta, "card");
  }
  // ── content shapes (static, brand-neutral; no wasm/RPC) ─────────────────────
  // These carry no populate RPC, so there is nothing to load — clear the meta and
  // draw straight from the descriptor. They emit the same `mer-*` classes the
  // web-react htmlKit does, so ONE skin styles both web renderers identically.
  if (body.case === "choice") {
    meta.textContent = "";
    root.appendChild(buildChoice(opts, body.value));
    return;
  }
  if (body.case === "snippet") {
    meta.textContent = "";
    if (body.value.snippet) root.appendChild(buildSnippet(body.value.snippet));
    return;
  }
  if (body.case === "action") {
    meta.textContent = "";
    root.appendChild(buildAction(opts, body.value));
    return;
  }
  if (body.case === "copyValue") {
    meta.textContent = "";
    if (body.value.value) root.appendChild(buildCopyValue(body.value.value));
    return;
  }
  if (body.case === "connectFlow") {
    meta.textContent = "";
    root.appendChild(buildConnectFlow(opts, body.value));
    return;
  }
  if (body.case === "catalog") {
    meta.textContent = "";
    root.appendChild(buildCatalog(opts, body.value));
    return;
  }
  meta.textContent = "(no body set)";
}

// Fill `{field}` placeholders in a URL template from the render context — the
// selected row first (e.g. the clicked workspace's `name`), then the trailing
// segment of `currentResourcePath` as a fallback for `{name}`. Unknown keys
// resolve to "" so a partially-bound template still produces a valid URL.
function fillTemplate(tpl: string, ctx: RenderContext): string {
  return tpl.replace(/\{([^}]+)\}/g, (_m, key: string) => {
    const fromRow = ctx.selectedRow
      ? resolvePath(ctx.selectedRow, key)
      : undefined;
    if (fromRow != null && fromRow !== "") return String(fromRow);
    if (key === "name" && ctx.currentResourcePath) {
      const segs = ctx.currentResourcePath.split("/");
      return segs[segs.length - 1] ?? "";
    }
    return "";
  });
}

// ===========================================================================
// Content shapes — imperative DOM builders with real interactivity (copy, tab
// switch, secret reveal) wired via addEventListener, since this renderer runs
// live in the browser. Field-complete to the same parity contract the web-react
// kits enforce: icon (host glyph via renderIcon + data-icon), option/affordance
// description, snippet language, secret mask+reveal, empty-state placeholder.
// ===========================================================================

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function copyOnClick(button: HTMLElement, text: string): void {
  button.addEventListener("click", () => {
    void navigator?.clipboard?.writeText(text);
    const prev = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = prev;
    }, 1200);
  });
}

// Glyph: the host resolver's element when wired, else nothing — but the key is
// always carried on the parent's `data-icon`, so it is never dropped.
function appendGlyph(opts: RenderPanelOptions, parent: HTMLElement, key: string): void {
  if (!key) return;
  parent.dataset.icon = key;
  const glyph = opts.renderIcon?.(key);
  if (glyph) {
    glyph.classList.add("mer-icon");
    parent.appendChild(glyph);
  }
}

function buildAffordance(opts: RenderPanelOptions, aff: Affordance): HTMLElement {
  const item = el("span", "mer-affordance-item");
  const primary = aff.style === AffordanceStyle.PRIMARY;
  const cls = `mer-affordance${primary ? " mer-affordance-primary" : ""}`;
  let control: HTMLElement;
  if (aff.invoke.case === "uri") {
    const a = el("a", cls);
    (a as HTMLAnchorElement).href = aff.invoke.value;
    control = a;
  } else {
    control = el("button", `${cls} mer-copy`);
    (control as HTMLButtonElement).type = "button";
    copyOnClick(control, aff.invoke.case === "command" ? aff.invoke.value : "");
  }
  if (aff.icon) control.dataset.icon = aff.icon;
  if (aff.description) control.title = aff.description;
  appendGlyph(opts, control, aff.icon);
  control.appendChild(el("span", undefined, aff.label));
  item.appendChild(control);
  // Description rendered inline (not just a tooltip) so it is never dropped.
  if (aff.description) item.appendChild(el("span", "mer-affordance-desc", aff.description));
  return item;
}

function buildSnippet(snippet: Snippet): HTMLElement {
  const fig = el("figure", "mer-snippet");
  if (snippet.language) fig.dataset.lang = snippet.language;
  const caption = snippet.path || snippet.label;
  if (caption || snippet.language) {
    const cap = el("figcaption", "mer-snippet-caption", caption);
    if (snippet.language) cap.appendChild(el("span", undefined, ` (${snippet.language})`));
    fig.appendChild(cap);
  }
  const copy = el("button", "mer-copy mer-snippet-copy", "Copy");
  (copy as HTMLButtonElement).type = "button";
  copyOnClick(copy, snippet.content);
  fig.appendChild(copy);
  const pre = el("pre", "mer-snippet-pre");
  pre.appendChild(el("code", undefined, snippet.content));
  fig.appendChild(pre);
  return fig;
}

function buildCopyValue(value: CopyValue): HTMLElement {
  const wrap = el("div", "mer-copyvalue");
  if (value.secret) wrap.dataset.secret = "true";
  if (value.label) wrap.appendChild(el("span", "mer-copyvalue-label", value.label));
  const btn = el("button", "mer-copy mer-copyvalue-btn");
  (btn as HTMLButtonElement).type = "button";
  const code = el("code", "mer-copyvalue-value", value.secret ? "••••••••" : value.value);
  btn.appendChild(code);
  copyOnClick(btn, value.value); // copy always yields plaintext
  wrap.appendChild(btn);
  if (value.secret) {
    const reveal = el("button", "mer-reveal", "Reveal");
    (reveal as HTMLButtonElement).type = "button";
    reveal.setAttribute("aria-pressed", "false");
    let shown = false;
    reveal.addEventListener("click", () => {
      shown = !shown;
      code.textContent = shown ? value.value : "••••••••";
      reveal.textContent = shown ? "Hide" : "Reveal";
      reveal.setAttribute("aria-pressed", String(shown));
    });
    wrap.appendChild(reveal);
  }
  if (value.help) wrap.appendChild(el("span", "mer-copyvalue-help", value.help));
  return wrap;
}

function buildChoice(opts: RenderPanelOptions, panel: ChoicePanel): HTMLElement {
  const wrap = el("div", "mer-choice");
  wrap.setAttribute("role", "tablist");
  wrap.dataset.style = String(panel.style);
  if (panel.prompt) wrap.appendChild(el("p", "mer-choice-prompt", panel.prompt));
  const list = el("div", "mer-choice-options");
  const defId = panel.defaultOptionId || panel.options[0]?.id;
  const tabs: HTMLElement[] = [];
  for (const opt of panel.options) {
    const b = el("button", "mer-choice-option");
    (b as HTMLButtonElement).type = "button";
    b.setAttribute("role", "tab");
    b.dataset.option = opt.id;
    b.setAttribute("aria-selected", String(opt.id === defId));
    appendGlyph(opts, b, opt.icon);
    b.appendChild(el("span", "mer-choice-option-label", opt.label));
    if (opt.description) b.appendChild(el("span", "mer-choice-option-desc", opt.description));
    b.addEventListener("click", () => {
      for (const t of tabs) t.setAttribute("aria-selected", String(t === b));
    });
    tabs.push(b);
    list.appendChild(b);
  }
  wrap.appendChild(list);
  return wrap;
}

function buildAction(opts: RenderPanelOptions, panel: ActionPanel): HTMLElement {
  const wrap = el("div", "mer-action");
  if (panel.description) wrap.appendChild(el("p", "mer-action-desc", panel.description));
  if (panel.action) wrap.appendChild(buildAffordance(opts, panel.action));
  return wrap;
}

function buildCatalog(opts: RenderPanelOptions, panel: CatalogPanel): HTMLElement {
  const wrap = el("div", "mer-catalog");
  wrap.dataset.style = String(panel.style);
  if (panel.items.length === 0) {
    wrap.appendChild(el("p", "mer-empty", panel.placeholder || "(empty)"));
    return wrap;
  }
  for (const item of panel.items) {
    const card = el("article", "mer-catalog-item");
    if (item.icon) card.dataset.icon = item.icon;
    const head = el("div", "mer-catalog-head");
    const name = el("span", "mer-catalog-name");
    appendGlyph(opts, name, item.icon);
    name.appendChild(el("span", undefined, item.name));
    head.appendChild(name);
    if (item.state) head.appendChild(el("span", "mer-catalog-state", item.state));
    card.appendChild(head);
    if (item.description) card.appendChild(el("p", "mer-catalog-desc", item.description));
    if (item.tag) card.appendChild(el("span", "mer-catalog-tag", item.tag));
    if (item.action) card.appendChild(buildAffordance(opts, item.action));
    wrap.appendChild(card);
  }
  return wrap;
}

function buildConnectFlow(opts: RenderPanelOptions, panel: ConnectFlowPanel): HTMLElement {
  const wrap = el("div", "mer-connect");
  if (panel.prompt) wrap.appendChild(el("p", "mer-connect-prompt", panel.prompt));
  if (panel.endpoint) wrap.appendChild(buildCopyValue(panel.endpoint));
  if (panel.targets.length === 0) {
    wrap.appendChild(el("p", "mer-empty", panel.placeholder || "(no targets)"));
    return wrap;
  }
  const defId = panel.defaultTargetId || panel.targets[0]?.id;
  const tabs = el("div", "mer-connect-tabs");
  tabs.setAttribute("role", "tablist");
  const bodies = el("div", "mer-connect-bodies");
  const tabEls: HTMLElement[] = [];
  const bodyEls: HTMLElement[] = [];
  for (const t of panel.targets) {
    const tab = el("button", "mer-connect-tab");
    (tab as HTMLButtonElement).type = "button";
    tab.setAttribute("role", "tab");
    tab.dataset.target = t.id;
    tab.setAttribute("aria-selected", String(t.id === defId));
    appendGlyph(opts, tab, t.icon);
    tab.appendChild(el("span", undefined, t.label));
    tabs.appendChild(tab);

    const section = el("section", "mer-connect-body");
    section.dataset.target = t.id;
    section.hidden = t.id !== defId;
    if (t.name) section.appendChild(el("h3", "mer-connect-name", t.name));
    if (t.description) section.appendChild(el("p", "mer-connect-note", t.description));
    if (t.actions.length > 0) {
      const row = el("div", "mer-connect-actions");
      for (const a of t.actions) row.appendChild(buildAffordance(opts, a));
      section.appendChild(row);
    }
    for (const s of t.configs) section.appendChild(buildSnippet(s));
    bodies.appendChild(section);

    tab.addEventListener("click", () => {
      for (const x of tabEls) x.setAttribute("aria-selected", String(x === tab));
      for (const b of bodyEls) b.hidden = b.dataset.target !== t.id;
    });
    tabEls.push(tab);
    bodyEls.push(section);
  }
  wrap.appendChild(tabs);
  wrap.appendChild(bodies);
  return wrap;
}

// GrammarPanel — a declarative rendering grammar (markdown / mermaid / plantuml /
// graphviz / vega). Content negotiation for grammars: the descriptor names the
// (language, source); the host's renderGrammar is the surface's transcoder set —
// it returns an element for languages this surface can display, or null when it
// can't. On null the kit walks the DEGRADATION LADDER, so it never blanks:
//   (1) MARKDOWN → a minimal native md→DOM render (text is universally displayable);
//   (2) else `alt` (author text fallback) if set;
//   (3) else the `source` in a labeled code block (always displayable — it's text).
// The kit imports NO grammar library. SSR-safe: the source is preserved in a
// text/plain <script> for host hydration.
function buildGrammar(opts: RenderPanelOptions, panel: GrammarPanel): HTMLElement {
  const lang = grammarLanguageName(panel.language);
  const wrap = el("div", "mer-grammar");
  wrap.dataset.grammarLanguage = lang;
  if (panel.title) wrap.appendChild(el("div", "mer-grammar-title", panel.title));
  const src = document.createElement("script");
  src.setAttribute("type", "text/plain");
  src.className = "mer-grammar-source";
  src.textContent = panel.source;
  wrap.appendChild(src);

  const mount = el("div", "mer-grammar-mount");
  wrap.appendChild(mount);

  // Try the surface's transcoder first.
  const rendered = opts.renderGrammar?.({ language: lang, source: panel.source, data: panel.data });
  if (rendered instanceof HTMLElement) {
    mount.appendChild(rendered);
  } else if (lang === "markdown") {
    // Ladder (1): markdown is text — render it natively, no library.
    mount.appendChild(renderMarkdown(panel.source));
  } else if (panel.alt) {
    // Ladder (2): author-provided text fallback.
    mount.appendChild(el("p", "mer-grammar-alt", panel.alt));
  } else {
    // Ladder (3): the source verbatim, labeled with its language.
    const fig = el("figure", "mer-grammar-fallback");
    fig.appendChild(el("figcaption", "mer-grammar-fallback-label", lang || "source"));
    const pre = el("pre");
    pre.appendChild(el("code", undefined, panel.source));
    fig.appendChild(pre);
    mount.appendChild(fig);
  }
  if (panel.caption) wrap.appendChild(el("div", "mer-grammar-caption", panel.caption));
  return wrap;
}

// GrammarLanguage enum → the lowercase token on data-grammar-language + passed to
// renderGrammar. 1=markdown 2=mermaid 3=plantuml 4=graphviz 5=vega-lite 6=vega
// (0/unknown → "").
function grammarLanguageName(language: number): string {
  return (
    ["", "markdown", "mermaid", "plantuml", "graphviz", "vega-lite", "vega"][language] ?? ""
  );
}

// Minimal, dependency-free markdown → DOM for the degradation ladder: ATX
// headings, fenced code, unordered lists, and inline **bold** / `code`. Not a
// full CommonMark parser — a legible native fallback (a host wanting fidelity
// wires renderGrammar with a real markdown lib).
function renderMarkdown(source: string): HTMLElement {
  const root = el("div", "mer-grammar-markdown");
  const lines = source.split("\n");
  let list: HTMLElement | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++; // closing fence
      const pre = el("pre");
      pre.appendChild(el("code", undefined, buf.join("\n")));
      root.appendChild(pre);
      list = null;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      root.appendChild(inlineMd(el(`h${Math.min(h[1].length + 2, 6)}`), h[2]));
      list = null;
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!list) {
        list = el("ul");
        root.appendChild(list);
      }
      list.appendChild(inlineMd(document.createElement("li"), line.replace(/^\s*[-*]\s+/, "")));
    } else if (line.trim() === "") {
      list = null;
    } else {
      root.appendChild(inlineMd(el("p"), line));
      list = null;
    }
    i++;
  }
  return root;
}

// Apply inline **bold** + `code` into `host`, escaping via textContent (no HTML
// injection — every segment is a text node or a <strong>/<code> wrapping text).
function inlineMd(host: HTMLElement, text: string): HTMLElement {
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) host.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[2] !== undefined) host.appendChild(el("strong", undefined, m[2]));
    else host.appendChild(el("code", undefined, m[3]));
    last = m.index + m[0].length;
  }
  if (last < text.length) host.appendChild(document.createTextNode(text.slice(last)));
  return host;
}

// StatPanel — a KPI tile. Delta/trend/formatting come from the SHARED computeStat
// (@savvifi/meridian-schemas/uiview), identical to the react kits + tui — the
// delta/trend is COMPUTED, never author-marked. Semantic color (via
// data-semantics) only when higher_is_better is set. Hand-drawn SVG sparkline
// via the shared statSparklinePoints (no chart library).
function buildStat(panel: StatPanel): HTMLElement {
  const s = computeStat(panel);
  const wrap = el("div", "mer-stat");
  wrap.dataset.trend = s.trend;
  wrap.dataset.semantics = s.semantics;
  wrap.appendChild(el("div", "mer-stat-label", panel.label));

  const row = el("div", "mer-stat-value-row");
  row.appendChild(el("span", "mer-stat-value", s.formattedValue));
  if (s.formattedDelta) {
    const arrow = trendArrow(s.trend);
    const delta = el("span", "mer-stat-delta", (arrow ? `${arrow} ` : "") + s.formattedDelta);
    delta.dataset.semantics = s.semantics;
    delta.dataset.trend = s.trend;
    row.appendChild(delta);
  }
  wrap.appendChild(row);

  const points = statSparklinePoints(s.series);
  if (points) {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "mer-stat-spark");
    svg.setAttribute("viewBox", "0 0 100 24");
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "24");
    svg.setAttribute("preserveAspectRatio", "none");
    const line = document.createElementNS(svgNs, "polyline");
    line.setAttribute("points", points);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
    wrap.appendChild(svg);
  }
  if (panel.caption) wrap.appendChild(el("div", "mer-stat-caption", panel.caption));
  return wrap;
}

// Renders a FormPanel (entity detail section) as a DOM form. READONLY draws the
// fields as a read-only card; EDIT draws inputs. Field values (READONLY) + submit
// wiring (EDIT) are host concerns; this renders the structure. FORM_MODE_EDIT = 2.
function buildForm(panel: FormPanel): HTMLElement {
  const form = document.createElement("form");
  form.className = "meridian-uiview-form";
  const edit = panel.mode === 2;
  for (const field of panel.fields) {
    const label = document.createElement("label");
    label.className = "meridian-uiview-field";
    const span = document.createElement("span");
    span.className = "meridian-uiview-field-label";
    span.textContent = field.label;
    label.appendChild(span);
    if (edit) {
      const input = document.createElement("input");
      input.name = field.fieldId;
      label.appendChild(input);
    } else {
      const value = document.createElement("span");
      value.className = "meridian-uiview-field-value";
      value.dataset.field = field.fieldId;
      label.appendChild(value);
    }
    form.appendChild(label);
  }
  return form;
}

// ---------------------------------------------------------------------------
// Table panel.
//
// Three things a TablePanel has always DESCRIBED but this renderer never drew,
// which together made every table in a web-components host inert:
//
//   • row selection — `FieldBinding.row_field` is documented as "pull a field
//     from the selected row", and `RenderContext.selectedRow` exists to carry
//     it, but nothing ever selected a row.
//   • `TablePanel.actions` — the RowActions. Descriptors in the wild declare
//     them (fastverk's builds table has three) and they simply never appeared.
//   • `TableColumn.link` — ColumnLink, whose own comment specifies the
//     `resolveHref` host seam. That seam did not exist until schemas 0.18.0.
//
// The populate → draw cycle is a closure here rather than a one-shot so a row
// action can re-fetch in place (`refresh_on_success`) without the host
// re-mounting the panel.
// ---------------------------------------------------------------------------

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

  // Selection is panel-local state: the RAW row (what bindings read) plus its
  // index (what the DOM highlights). Held here so `refresh` can try to keep the
  // reader's place across a re-fetch.
  let selectedIndex = -1;
  let rows: RenderedRow[] = [];

  const actionsBar = table.actions.length
    ? document.createElement("div")
    : null;
  if (actionsBar) {
    actionsBar.className = "meridian-uiview-actions";
    root.appendChild(actionsBar);
  }
  const host = document.createElement("div");
  host.className = "meridian-uiview-body";
  root.appendChild(host);

  const selectedRow = (): Record<string, unknown> | null =>
    selectedIndex >= 0 && selectedIndex < rows.length
      ? plainRow(rows[selectedIndex].raw)
      : null;

  // A RowAction is enabled only when a row is selected AND `enabled_when`
  // matches it. The predicate compares against the RENDERED form of the field
  // (RowFilter's own wording), which is what `readPath` over the raw row gives.
  const actionEnabled = (action: TablePanel["actions"][number]): boolean => {
    const row = selectedRow();
    if (!row) return false;
    const filter = action.enabledWhen;
    if (!filter) return true;
    const actual = wasm.readPath(row, filter.fieldPath);
    return actual != null && String(actual) === filter.equals;
  };

  const buttons: Array<{ el: HTMLButtonElement; action: TablePanel["actions"][number] }> = [];
  const syncButtons = () => {
    for (const { el, action } of buttons) el.disabled = !actionEnabled(action);
  };

  const draw = () => {
    host.replaceChildren(
      buildTable(opts, table, rows, selectedIndex, (i) => {
        selectedIndex = i;
        drawSelection();
        syncButtons();
      }),
    );
  };

  // Repaint only the selection highlight — a full redraw on every click would
  // drop scroll position and any focus inside the table.
  const drawSelection = () => {
    const trs = host.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row]");
    trs.forEach((tr, i) => {
      const on = i === selectedIndex;
      tr.classList.toggle("selected", on);
      tr.setAttribute("aria-selected", on ? "true" : "false");
    });
  };

  const refresh = async (): Promise<void> => {
    let response: object;
    try {
      const request = plainValue(wasm.buildPopulateRequest(descriptorBytes, opts.context));
      response = await invoker.invoke(populate.service, populate.method, request as object);
    } catch (err) {
      metaEl.textContent = `Failed: ${(err as Error).message}`;
      return;
    }
    rows = wasm.renderTable(descriptorBytes, response);
    // A re-fetch can shrink the list out from under the selection; clamp rather
    // than silently pointing at a different record than the one highlighted.
    if (selectedIndex >= rows.length) selectedIndex = -1;
    metaEl.textContent = `${rows.length} ${table.itemNoun || "items"}`;
    draw();
    syncButtons();
  };

  for (const action of table.actions) {
    if (!actionsBar) break;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.disabled = true;
    btn.addEventListener("click", async () => {
      const row = selectedRow();
      if (!row || !action.rpc) return;
      btn.disabled = true;
      try {
        const request = plainValue(
          wasm.buildRequest(toBinary(RpcCallSchema, action.rpc), {
            ...opts.context,
            selectedRow: row,
          }),
        );
        await invoker.invoke(action.rpc.service, action.rpc.method, request as object);
        // `RowAction.refresh_on_success` documents a default of TRUE, which a
        // non-presence proto3 bool cannot express (absent == false). We follow
        // the documented contract and always re-fetch; a descriptor that must
        // NOT refresh needs the field made `optional` upstream first.
        await refresh();
      } catch (err) {
        metaEl.textContent = `${action.label} failed: ${(err as Error).message}`;
      } finally {
        syncButtons();
      }
    });
    buttons.push({ el: btn, action });
    actionsBar.appendChild(btn);
  }

  await refresh();
}

/**
 * Draw the table. `onSelect` null ⇒ rows are NOT selectable — used by the LRO
 * result table, which has no actions bar, so making its rows focusable and
 * clickable would advertise an interaction that does nothing.
 */
function buildTable(
  opts: RenderPanelOptions,
  table: TablePanel,
  rows: RenderedRow[],
  selectedIndex: number,
  onSelect: ((index: number) => void) | null,
): HTMLElement {
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
    const selectable = onSelect !== null && table.actions.length > 0;
    rows.forEach((row, i) => {
      const tr = document.createElement("tr");
      tr.dataset.row = String(i);
      if (selectable) {
        tr.tabIndex = 0;
        tr.setAttribute("role", "row");
        tr.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
        if (i === selectedIndex) tr.classList.add("selected");
        tr.addEventListener("click", () => onSelect(i));
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(i);
          }
        });
      }
      row.cells.forEach((cell, c) => {
        const td = document.createElement("td");
        td.appendChild(buildCell(opts, table, c, cell, row));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  tableEl.appendChild(tbody);
  return tableEl;
}

/**
 * One cell. A column carrying a `ColumnLink` asks the HOST for the destination
 * (`resolveHref`) — meridian never builds a URL. The host gets the target kind,
 * the cell's value (the entity id, per ColumnLink's contract) and the raw row,
 * so a host whose route needs a different field than the one displayed can read
 * it. No resolver, or a resolver that declines, ⇒ plain text: never a dead link.
 */
function buildCell(
  opts: RenderPanelOptions,
  table: TablePanel,
  columnIndex: number,
  cell: string,
  row: RenderedRow,
): Node {
  const link = table.columns[columnIndex]?.link;
  if (link && opts.resolveHref) {
    const href = opts.resolveHref({
      targetKind: link.targetKind,
      id: cell,
      row: plainRow(row.raw),
    });
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = cell;
      // A link inside a selectable row must not also toggle the selection.
      a.addEventListener("click", (e) => e.stopPropagation());
      return a;
    }
  }
  return document.createTextNode(cell);
}

// ---------------------------------------------------------------------------
// Record-bound panels: DetailHeaderPanel + RecordCardPanel.
//
// The two bodies of a DETAIL view. Both fetch ONE record through `populate` with
// the view's subject bound into `id_field` (default "id"), then read dotted paths
// out of the result — a header renders title/subtitle/status + descriptor rows, a
// card renders a labeled-value grid. Same tier, so one implementation.
//
// WHERE THE SUBJECT COMES FROM. `ViewDescriptor.subject_id` is the canonical
// carrier, but `renderPanel` receives a PanelDescriptor, not a view — a panel can
// be mounted standalone. So the subject is taken from the RenderContext's
// `currentResourcePath`, which rpc.proto defines as host-assigned ("a URI, an
// opaque resource id") and which a host driving a detail view sets to the record
// it is displaying. A host that sets neither gets a fetch with no id, which is
// the server's call to reject — not something to fail silently over here.
// ---------------------------------------------------------------------------

async function renderRecordPanel(
  opts: RenderPanelOptions,
  panel: DetailHeaderPanel | RecordCardPanel,
  metaEl: HTMLElement,
  mode: "header" | "card",
): Promise<void> {
  const { root, invoker, wasm } = opts;
  const populate = panel.populate;
  if (!populate) {
    metaEl.textContent = "(no populate RPC)";
    return;
  }
  const idField = panel.idField || "id";
  const subject = opts.context.currentResourcePath;
  let record: object;
  try {
    const request: Record<string, unknown> = {};
    if (subject) request[idField] = subject;
    record = await invoker.invoke(populate.service, populate.method, request);
  } catch (err) {
    metaEl.textContent = `Failed: ${(err as Error).message}`;
    return;
  }
  metaEl.textContent = "";

  const read = (path: string): string => {
    if (!path) return "";
    const v = wasm.readPath(record, path);
    return v == null ? "" : String(v);
  };

  const box = document.createElement("div");
  box.className = "meridian-uiview-body";

  if (mode === "header") {
    const p = panel as DetailHeaderPanel;
    // A resolved path WINS over the literal `title` — but only when it resolves
    // to something. An empty path must not blank out authored copy.
    const resolved = read(p.titleSourcePath);
    const title = resolved || p.title;
    if (title) {
      const h = document.createElement("h2");
      h.className = "meridian-uiview-record-title";
      h.textContent = title;
      box.appendChild(h);
    }
    const status = read(p.statusSourcePath);
    if (status) {
      const chip = document.createElement("span");
      chip.className = "meridian-uiview-record-status";
      // A status drives styling in every kit; expose it as data so a skin can
      // color "Failed" differently from "Succeeded" without the renderer
      // hardcoding either vocabulary.
      chip.dataset.status = status.toLowerCase();
      chip.textContent = status;
      box.appendChild(chip);
    }
    const subtitle = read(p.subtitleSourcePath);
    if (subtitle) {
      const s = document.createElement("p");
      s.className = "meridian-uiview-record-subtitle";
      s.textContent = subtitle;
      box.appendChild(s);
    }
    box.appendChild(
      buildDescriptorRows(
        p.descriptorRows.map((r) => ({ label: r.label, value: read(r.sourcePath) })),
      ),
    );
  } else {
    const p = panel as RecordCardPanel;
    box.appendChild(
      buildDescriptorRows(
        p.fields.map((f) => ({ label: f.label || f.fieldId, value: read(f.fieldId) })),
      ),
    );
  }
  root.appendChild(box);
}

/** A labeled-value grid — read-only values, NOT disabled inputs. */
function buildDescriptorRows(rows: Array<{ label: string; value: string }>): HTMLElement {
  const grid = document.createElement("dl");
  grid.className = "meridian-uiview-record-rows";
  for (const { label, value } of rows) {
    // An empty value still renders its label: on a detail view "Team: —" is
    // information (nobody set one), whereas a missing row reads as a schema that
    // never had the field.
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "—";
    if (!value) dd.classList.add("empty");
    grid.appendChild(dt);
    grid.appendChild(dd);
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Stream panel.
//
// An append-only line stream rendered as a following pane. The host owns the
// transport (`streamInvoker`); this draws lines, bounds retention, and follows
// the tail. Per stream.proto, FOLLOW means "pinned to the newest line ONLY while
// the reader is at the bottom" — someone who has scrolled up is reading, and
// yanking them back down is the classic log-viewer bug.
//
// Degradation (stream.proto's ladder): no `streamInvoker` ⇒ the placeholder,
// with the reason surfaced in the meta line. Never blank, never a crash.
// ---------------------------------------------------------------------------

const STREAM_DEFAULT_MAX_LINES = 2000;
/** Distance from the bottom, in px, still counted as "at the bottom". */
const STREAM_FOLLOW_SLACK_PX = 40;

function renderStreamPanel(
  opts: RenderPanelOptions,
  panel: StreamPanel,
  metaEl: HTMLElement,
): void {
  const { root, wasm } = opts;
  const noun = panel.itemNoun || "lines";

  // Wrapped in a body slot (like terminal / adhoc) so the `--mer-*` design
  // tokens resolve for the pane's own surface + mono font.
  const slot = document.createElement("div");
  slot.className = "meridian-uiview-body";
  root.appendChild(slot);

  const pane = document.createElement("div");
  pane.className = "meridian-uiview-stream";
  pane.setAttribute("role", "log");
  pane.setAttribute("aria-live", "polite");
  slot.appendChild(pane);

  const placeholder = document.createElement("div");
  placeholder.className = "meridian-uiview-placeholder";
  placeholder.textContent = panel.placeholder || "Waiting for output…";
  pane.appendChild(placeholder);

  const subscribe = panel.subscribe;
  if (!subscribe) {
    metaEl.textContent = "(stream has no subscribe RPC)";
    return;
  }
  if (!opts.streamInvoker) {
    // The documented ladder: this surface has no stream transport, so the panel
    // shows its empty state and says why rather than pretending to be live.
    metaEl.textContent = "not live on this surface";
    return;
  }

  const follow = panel.followMode !== FollowMode.MANUAL; // UNSPECIFIED ⇒ FOLLOW
  const maxLines = panel.maxLines || STREAM_DEFAULT_MAX_LINES;
  let count = 0;

  const atBottom = () =>
    pane.scrollHeight - pane.clientHeight - pane.scrollTop < STREAM_FOLLOW_SLACK_PX;

  const append = (text: string) => {
    if (count === 0) placeholder.remove();
    // Read the scroll position BEFORE mutating — appending changes scrollHeight.
    const pinned = follow && atBottom();
    const line = document.createElement("div");
    line.className = "meridian-uiview-stream-line";
    line.textContent = text;
    pane.appendChild(line);
    count += 1;
    // A stream is unbounded; the pane must not be. Drop from the front.
    while (pane.childElementCount > maxLines) {
      pane.removeChild(pane.firstElementChild as Element);
    }
    metaEl.textContent = `${count} ${noun}`;
    if (pinned) pane.scrollTop = pane.scrollHeight;
  };

  // A frame is either bare text or a structured envelope; `line_field` selects
  // the human-readable text out of the latter (stream.proto). An object with no
  // `line_field`, or a path that resolves to nothing, is shown as JSON rather
  // than as "[object Object]" — a frame we can't interpret is still evidence.
  const textOf = (frame: string | object): string => {
    if (typeof frame === "string") return frame;
    if (panel.lineField) {
      const value = wasm.readPath(frame as object, panel.lineField);
      if (value != null) return String(value);
    }
    try {
      return JSON.stringify(frame);
    } catch {
      return String(frame);
    }
  };

  let request: object = {};
  try {
    request = plainValue(
      wasm.buildRequest(toBinary(RpcCallSchema, subscribe), opts.context),
    ) as object;
  } catch {
    // A binding that can't be resolved yet (no selected row, no subject) is not
    // fatal — subscribe with what we have and let the server decide.
  }

  const sub = opts.streamInvoker.subscribe(
    subscribe.service,
    subscribe.method,
    request,
    {
      onFrame: (frame) => append(textOf(frame)),
      onError: (err) => {
        metaEl.textContent = `${count} ${noun} — stream failed: ${err.message}`;
      },
      onClose: () => {
        metaEl.textContent = `${count} ${noun} — ended`;
      },
    },
  );
  onDispose(root, () => sub.close());
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

  // A "standalone" LRO (e.g. a create form) has a start RPC with no bindings, so it
  // does NOT act on the current resource — every input comes from the form. Such a
  // panel is always runnable; a resource-scoped LRO still needs an active resource.
  const standalone = (panel.start?.bindings?.length ?? 0) === 0;
  const runnable = standalone || !!opts.context.currentResourcePath;

  metaEl.textContent = runnable
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
    formRow.appendChild(buildFormInput(field, formGetters, opts.invoker));
  }
  if (panel.inputs.length > 0) {
    root.appendChild(formRow);
  }

  // Action row + run button.
  const actionRow = document.createElement("div");
  actionRow.style.padding = "4px 0";
  const runButton = document.createElement("button");
  runButton.textContent = panel.runButtonLabel || "Run";
  runButton.disabled = !runnable;
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

// The RPC-populated-dropdown shape (EnumSelection.options_source, schemas >=0.4.0).
// Read via a cast so this renderer builds against older @savvifi/meridian-proto-ts
// that predates the field — it's present at runtime once the emitter uses schemas
// >=0.4.0, and absent (falls back to allowed_values) otherwise.
interface OptionsSourceShape {
  service: string;
  method: string;
  optionsField: string;
  valueField: string;
  labelField: string;
}

// Walk a dotted ProtoPath (e.g. "configs" or "outer.items") over a decoded
// JSON-over-HTTP response object.
function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function buildFormInput(
  field: FormField,
  getters: Record<string, () => unknown>,
  invoker?: RpcInvoker,
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
  } else if (kind.case === "enumSelection") {
    const spec = kind.value;
    const select = document.createElement("select");
    getters[field.fieldId] = () => select.value;
    const src = (spec as unknown as { optionsSource?: OptionsSourceShape })
      .optionsSource;
    if (src && src.service) {
      // RPC-populated: render a placeholder, then fill the <select> once the
      // options RPC (e.g. ListConfigs) returns. Mirrors renderTablePanel's invoke.
      const loading = document.createElement("option");
      loading.textContent = "Loading…";
      loading.disabled = true;
      select.appendChild(loading);
      if (invoker) {
        invoker
          .invoke(src.service, src.method, {})
          .then((resp) => {
            select.replaceChildren();
            const items = resolvePath(resp, src.optionsField);
            const arr = Array.isArray(items) ? items : [];
            for (const it of arr) {
              const value = String(resolvePath(it, src.valueField) ?? "");
              const label = src.labelField
                ? resolvePath(it, src.labelField)
                : value;
              const opt = document.createElement("option");
              opt.value = value;
              opt.textContent = String(label ?? value);
              if (value === spec.defaultValue) opt.selected = true;
              select.appendChild(opt);
            }
            if (arr.length === 0) {
              const none = document.createElement("option");
              none.textContent = "(none)";
              none.disabled = true;
              select.appendChild(none);
            }
          })
          .catch((err: unknown) => {
            select.replaceChildren();
            const failed = document.createElement("option");
            failed.textContent = `Failed: ${(err as Error).message}`;
            failed.disabled = true;
            select.appendChild(failed);
          });
      }
    } else {
      // Static allowed_values.
      for (const value of spec.allowedValues) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        if (value === spec.defaultValue) opt.selected = true;
        select.appendChild(opt);
      }
    }
    wrapper.appendChild(select);
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
  const startRequest = plainValue(wasm.buildRequest(bytesForRpc(start), startCtx)) as object;
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
    const finalizeRequest = plainValue(wasm.buildRequest(bytesForRpc(finalize), finalizeCtx)) as object;
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
  // A static render of the operation's result — no selection, no actions bar
  // (unchanged behavior; the LRO shape drives its own lifecycle).
  resultArea.appendChild(buildTable(opts, result, rows, -1, null));
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
