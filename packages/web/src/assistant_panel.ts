// <m-assistant-panel> — the generic MCP-host chat plane (fastverk-chat), as
// opposed to <m-chat-panel> (the agora auction loop / KgViewEvent).
//
// Wire contract: `chat.v1` (proto/chat/v1/event.proto in botnoc). The answer is a
// stream of composable **blocks** + a transient **status** (thinking/working) —
// a meridian-native "block kit", not a text blob.
//   turn-url  default `/api/noc-agent/turn` — POST { message }
//   sse-url   default `/api/noc-agent/view` — SSE of `chat.v1.HostEvent`, each a
//             `{ seq, <oneof> }` where <oneof> is one of:
//               block  { blockId, role, <kind> }  — append, or UPDATE if blockId
//                        seen (a tool block flips running→ok). kinds: markdown /
//                        context / tool / list / fields / code / divider / table.
//               status { state: IDLE|THINKING|WORKING, detail }
//               done   { stopReason } · error { message }

import { escHtml as esc } from './dom.js';

interface HostEvent {
  seq: number;
  block?: BlockMsg;
  status?: { state: string; detail?: string };
  done?: { stopReason: string };
  error?: { message: string };
}
interface BlockMsg {
  blockId: string;
  role?: string;
  markdown?: { text: string };
  context?: { icon?: string; text: string };
  tool?: { name: string; argsJson?: string; state: string; summary?: string };
  list?: { title?: string; items: ListItem[] };
  fields?: { fields: { key: string; value: string }[] };
  code?: { language?: string; text: string };
  divider?: Record<string, never>;
  table?: { title?: string; columns: { key: string; label: string }[]; rows: { cells: Record<string, string> }[] };
}
interface ListItem {
  title?: string;
  subtitle?: string;
  badges?: string[];
  icon?: string;
}

export const ASSISTANT_PANEL_CSS = `
  m-assistant-panel { display: flex; flex-direction: column; height: 100%; min-height: 0;
    color: var(--text, #e5e7eb); font: 13px/1.5 system-ui, sans-serif; }
  m-assistant-panel .asst-log { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px;
    display: flex; flex-direction: column; gap: 12px; }
  m-assistant-panel .asst-row { display: flex; }
  m-assistant-panel .asst-row.user { justify-content: flex-end; }
  m-assistant-panel .asst-row > * { max-width: 82%; }

  /* markdown bubbles */
  m-assistant-panel .md { padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
  m-assistant-panel .asst-row.user .md { background: var(--accent, #6366f1); color: #fff; border-bottom-right-radius: 3px; }
  m-assistant-panel .asst-row.assistant .md { background: color-mix(in srgb, var(--surface, #1a1d27) 70%, #080910); border-bottom-left-radius: 3px; }
  m-assistant-panel .md code { font-family: ui-monospace, Menlo, monospace; font-size: 12px;
    background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 4px; }

  /* tool card */
  m-assistant-panel .tool { display: flex; align-items: center; gap: 8px; font: 12px/1.4 ui-monospace, Menlo, monospace;
    padding: 6px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 28%, transparent);
    background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent); color: var(--muted, #9ca3af); }
  m-assistant-panel .tool .tname { color: var(--text, #e5e7eb); }
  m-assistant-panel .tool .targs { opacity: 0.7; }
  m-assistant-panel .tool.err { border-color: color-mix(in srgb, #ef4444 45%, transparent); background: color-mix(in srgb, #ef4444 10%, transparent); color: #fca5a5; }
  m-assistant-panel .tool .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  m-assistant-panel .tool .dot.ok { background: #22c55e; }
  m-assistant-panel .tool .dot.err { background: #ef4444; }
  m-assistant-panel .spin { width: 10px; height: 10px; flex: none; border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--accent, #6366f1) 30%, transparent); border-top-color: var(--accent, #6366f1);
    animation: masp-spin 0.7s linear infinite; }
  @keyframes masp-spin { to { transform: rotate(360deg); } }

  /* list */
  m-assistant-panel .list { width: 100%; border: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 55%, #fff); border-radius: 10px; overflow: hidden; }
  m-assistant-panel .list .lhead { padding: 8px 12px; font-weight: 600; font-size: 12px; letter-spacing: .02em;
    background: color-mix(in srgb, var(--surface, #1a1d27) 65%, #080910); border-bottom: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 55%, #fff); }
  m-assistant-panel .list .litem { display: flex; align-items: baseline; gap: 8px; padding: 6px 12px; }
  m-assistant-panel .list .litem + .litem { border-top: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 45%, #000); }
  m-assistant-panel .list .ltitle { font-weight: 500; }
  m-assistant-panel .list .lsub { color: var(--muted, #9ca3af); font-size: 12px; }
  m-assistant-panel .list .lbadges { margin-left: auto; display: flex; gap: 4px; flex-wrap: wrap; }
  m-assistant-panel .badge { font-size: 11px; padding: 1px 6px; border-radius: 10px;
    background: color-mix(in srgb, var(--accent, #6366f1) 16%, transparent); color: color-mix(in srgb, var(--text, #e5e7eb) 85%, var(--accent)); }

  /* fields / code / context / divider */
  m-assistant-panel .fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 55%, #fff); border-radius: 10px; }
  m-assistant-panel .fields .k { color: var(--muted, #9ca3af); }
  m-assistant-panel pre.code { width: 100%; overflow: auto; padding: 10px 12px; border-radius: 10px; margin: 0;
    background: #0b0d14; font: 12px/1.5 ui-monospace, Menlo, monospace; }
  m-assistant-panel table.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
  m-assistant-panel table.tbl th, m-assistant-panel table.tbl td { text-align: left; padding: 5px 10px; border-bottom: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 45%, #000); }
  m-assistant-panel table.tbl th { color: var(--muted, #9ca3af); font-weight: 600; }
  m-assistant-panel .ctx { color: var(--muted, #9ca3af); font-size: 12px; }
  m-assistant-panel hr.div { width: 100%; border: none; border-top: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 45%, #fff); }
  m-assistant-panel .err { align-self: center; color: #fca5a5; font-size: 12px; }

  /* status row */
  m-assistant-panel .status { display: none; align-items: center; gap: 8px; color: var(--muted, #9ca3af); font-size: 12px; padding: 2px; }
  m-assistant-panel .status.on { display: flex; }
  m-assistant-panel .dots span { animation: masp-blink 1.2s infinite; }
  m-assistant-panel .dots span:nth-child(2) { animation-delay: .2s; }
  m-assistant-panel .dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes masp-blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }

  /* input */
  m-assistant-panel form.asst-input { display: flex; gap: 8px; padding: 12px 20px;
    border-top: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 60%, #fff); }
  m-assistant-panel input.asst-text { flex: 1; padding: 8px 12px; border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 50%, #fff); background: var(--surface, #1a1d27); color: var(--text, #e5e7eb); font: inherit; }
  m-assistant-panel button.asst-send { padding: 8px 16px; border-radius: 8px; border: none; background: var(--accent, #6366f1); color: #fff; font: inherit; cursor: pointer; }
  m-assistant-panel button.asst-send:disabled { opacity: .5; cursor: default; }
`;

function mdInline(text: string): string {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function renderBlockInner(b: BlockMsg): string {
  if (b.markdown) return `<div class="md">${mdInline(b.markdown.text || '')}</div>`;
  if (b.context) return `<div class="ctx">${b.context.icon ? esc(b.context.icon) + ' ' : ''}${esc(b.context.text)}</div>`;
  if (b.tool) {
    const t = b.tool;
    const err = t.state === 'ERROR';
    const ind = t.state === 'RUNNING'
      ? '<span class="spin"></span>'
      : `<span class="dot ${err ? 'err' : 'ok'}"></span>`;
    const args = t.argsJson && t.argsJson !== '{}' ? ` <span class="targs">${esc(t.argsJson)}</span>` : '';
    const summary = t.summary ? ` — ${esc(t.summary)}` : '';
    return `<div class="tool${err ? ' err' : ''}">${ind}<span class="tname">${esc(t.name)}</span>${args}${summary}</div>`;
  }
  if (b.list) {
    const items = (b.list.items || []).map((it) => {
      const badges = (it.badges || []).map((x) => `<span class="badge">${esc(x)}</span>`).join('');
      const sub = it.subtitle ? ` <span class="lsub">${esc(it.subtitle)}</span>` : '';
      return `<div class="litem"><span class="ltitle">${esc(it.title || '')}</span>${sub}<span class="lbadges">${badges}</span></div>`;
    }).join('');
    const head = b.list.title ? `<div class="lhead">${esc(b.list.title)}</div>` : '';
    return `<div class="list">${head}${items}</div>`;
  }
  if (b.fields) {
    const rows = (b.fields.fields || []).map((f) => `<div class="k">${esc(f.key)}</div><div>${esc(f.value)}</div>`).join('');
    return `<div class="fields">${rows}</div>`;
  }
  if (b.code) return `<pre class="code">${esc(b.code.text || '')}</pre>`;
  if (b.table) {
    const cols = b.table.columns || [];
    const head = cols.map((c) => `<th>${esc(c.label || c.key)}</th>`).join('');
    const body = (b.table.rows || []).map((r) =>
      `<tr>${cols.map((c) => `<td>${esc((r.cells || {})[c.key] || '')}</td>`).join('')}</tr>`).join('');
    return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  if (b.divider) return '<hr class="div">';
  return '';
}

export class MAssistantPanel extends HTMLElement {
  private source: EventSource | null = null;
  private logEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendEl: HTMLButtonElement | null = null;
  private blocks = new Map<string, HTMLElement>();
  private seen = new Set<number>();

  static get observedAttributes(): string[] {
    return ['sse-url', 'turn-url'];
  }
  get sseUrl(): string {
    return this.getAttribute('sse-url') || '/api/noc-agent/view';
  }
  get turnUrl(): string {
    return this.getAttribute('turn-url') || '/api/noc-agent/turn';
  }

  connectedCallback(): void {
    this.render();
    this.connectSse();
  }
  disconnectedCallback(): void {
    this.source?.close();
    this.source = null;
  }
  attributeChangedCallback(name: string): void {
    if (name === 'sse-url' && this.isConnected) {
      this.source?.close();
      this.connectSse();
    }
  }

  private render(): void {
    this.innerHTML = [
      '<div class="asst-log" data-log>',
      '<div class="ctx asst-empty">Ask about your repos, issues, or PRs — I\'ll use the connected tools.</div>',
      '<div class="status" data-status></div>',
      '</div>',
      '<form class="asst-input">',
      '<input class="asst-text" type="text" placeholder="Message fastverk chat…" autocomplete="off" />',
      '<button class="asst-send" type="submit">Send</button>',
      '</form>',
    ].join('');
    this.logEl = this.querySelector('[data-log]');
    this.statusEl = this.querySelector('[data-status]');
    this.inputEl = this.querySelector('input.asst-text');
    this.sendEl = this.querySelector('button.asst-send');
    this.querySelector('form.asst-input')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });
  }

  private connectSse(): void {
    this.source = new EventSource(this.sseUrl);
    this.source.onmessage = (msg) => {
      try {
        this.handle(JSON.parse(msg.data) as HostEvent);
      } catch (e) {
        console.error('assistant-panel: bad SSE frame', e, msg.data);
      }
    };
    this.source.onerror = (e) => console.warn('assistant-panel: SSE error (will retry)', e);
  }

  private handle(ev: HostEvent): void {
    if (typeof ev.seq === 'number') {
      if (this.seen.has(ev.seq)) return;
      this.seen.add(ev.seq);
    }
    if (ev.block) this.upsertBlock(ev.block);
    else if (ev.status) this.renderStatus(ev.status.state, ev.status.detail || '');
    else if (ev.done) {
      this.renderStatus('IDLE', '');
      if (this.sendEl) this.sendEl.disabled = false;
    } else if (ev.error) {
      this.appendError(ev.error.message);
      this.renderStatus('IDLE', '');
      if (this.sendEl) this.sendEl.disabled = false;
    }
  }

  private upsertBlock(b: BlockMsg): void {
    const log = this.logEl;
    if (!log) return;
    log.querySelector('.asst-empty')?.remove();
    let el = this.blocks.get(b.blockId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'asst-row ' + (b.role === 'user' ? 'user' : 'assistant');
      log.insertBefore(el, this.statusEl);
      this.blocks.set(b.blockId, el);
    }
    el.innerHTML = renderBlockInner(b);
    this.scrollDown();
  }

  private appendError(message: string): void {
    const log = this.logEl;
    if (!log) return;
    const el = document.createElement('div');
    el.className = 'err';
    el.textContent = '⚠ ' + message;
    log.insertBefore(el, this.statusEl);
    this.scrollDown();
  }

  private renderStatus(state: string, detail: string): void {
    const s = this.statusEl;
    if (!s) return;
    if (state === 'THINKING') {
      s.innerHTML = 'Thinking<span class="dots"><span>.</span><span>.</span><span>.</span></span>';
      s.className = 'status on';
    } else if (state === 'WORKING') {
      s.innerHTML = `<span class="spin"></span>${esc(detail || 'Working…')}`;
      s.className = 'status on';
    } else {
      s.className = 'status';
      s.innerHTML = '';
    }
    this.scrollDown();
  }

  private scrollDown(): void {
    this.logEl?.scrollTo({ top: this.logEl.scrollHeight });
  }

  private async send(): Promise<void> {
    const q = this.inputEl?.value.trim();
    if (!q || !this.sendEl) return;
    this.sendEl.disabled = true;
    if (this.inputEl) this.inputEl.value = '';
    try {
      const resp = await fetch(this.turnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q }),
      });
      if (!resp.ok) {
        console.error('assistant-panel: turn failed', resp.status, await resp.text());
        this.sendEl.disabled = false;
      }
    } catch (e) {
      console.error('assistant-panel: turn error', e);
      this.sendEl.disabled = false;
    } finally {
      this.inputEl?.focus();
    }
  }
}

/** Idempotent registration. Call once at app start. */
export function registerAssistantPanel(): void {
  if (!customElements.get('m-assistant-panel')) {
    customElements.define('m-assistant-panel', MAssistantPanel);
  }
}
