// <m-assistant-panel> — a meridian primitive that renders the GENERIC
// MCP-host chat plane (fastverk-chat), as opposed to <m-chat-panel>
// which renders the agora auction loop (bids/prices/KG-deltas).
//
// Wire contract: `chat.v1` (proto/chat/v1/event.proto in botnoc).
//   turn-url  default `/api/noc-agent/turn` — POST { message } (chat.v1.TurnRequest)
//   sse-url   default `/api/noc-agent/view` — SSE stream of `chat.v1.HostEvent`
//             (proto3-JSON, one per `data:` frame). Each event is
//             { seq, <oneof> } where <oneof> is one of:
//               turnStarted    { message }
//               assistantDelta { text }
//               toolCall       { id, plugin, tool, argumentsJson }
//               toolResult     { id, isError, summary }
//               done           { stopReason }
//               error          { message }
//
// The panel renders a plain transcript: user message, streamed assistant
// text, and a muted tool-call trace inline, in arrival order. The stream is
// the single source of truth (we don't render from the POST response).

import { escHtml as esc } from './dom.js';

interface HostEvent {
  seq: number;
  turnStarted?: { message: string };
  assistantDelta?: { text: string };
  toolCall?: { id: string; plugin: string; tool: string; argumentsJson: string };
  toolResult?: { id: string; isError: boolean; summary: string };
  done?: { stopReason: string };
  error?: { message: string };
}

export const ASSISTANT_PANEL_CSS = `
  m-assistant-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    color: var(--text, #e5e7eb);
    font: 13px/1.5 system-ui, sans-serif;
  }
  m-assistant-panel .asst-log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  m-assistant-panel .asst-row { display: flex; }
  m-assistant-panel .asst-row.user { justify-content: flex-end; }
  m-assistant-panel .asst-bubble {
    max-width: 80%;
    padding: 8px 12px;
    border-radius: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  m-assistant-panel .asst-row.user .asst-bubble {
    background: var(--accent, #6366f1);
    color: #fff;
    border-bottom-right-radius: 3px;
  }
  m-assistant-panel .asst-row.assistant .asst-bubble {
    background: color-mix(in srgb, var(--surface, #1a1d27) 70%, #080910);
    border-bottom-left-radius: 3px;
  }
  m-assistant-panel .asst-tool {
    align-self: flex-start;
    max-width: 90%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 30%, transparent);
    background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
    color: var(--muted, #9ca3af);
  }
  m-assistant-panel .asst-tool .tool-name { color: var(--text, #e5e7eb); }
  m-assistant-panel .asst-tool.err {
    border-color: color-mix(in srgb, #ef4444 45%, transparent);
    background: color-mix(in srgb, #ef4444 12%, transparent);
    color: #fca5a5;
  }
  m-assistant-panel .asst-error {
    align-self: center;
    color: #fca5a5;
    font-size: 12px;
    padding: 6px 10px;
  }
  m-assistant-panel .asst-empty { color: var(--muted, #9ca3af); margin: auto; }
  m-assistant-panel form.asst-input {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 60%, #fff);
  }
  m-assistant-panel input.asst-text {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--surface, #1a1d27) 50%, #fff);
    background: var(--surface, #1a1d27);
    color: var(--text, #e5e7eb);
    font: inherit;
  }
  m-assistant-panel button.asst-send {
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    background: var(--accent, #6366f1);
    color: #fff;
    font: inherit;
    cursor: pointer;
  }
  m-assistant-panel button.asst-send:disabled { opacity: 0.5; cursor: default; }
`;

export class MAssistantPanel extends HTMLElement {
  private source: EventSource | null = null;
  private logEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendEl: HTMLButtonElement | null = null;
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
      '<div class="asst-empty">Ask about your repos, builds, or modules — I\'ll use the connected tools.</div>',
      '</div>',
      '<form class="asst-input">',
      '<input class="asst-text" type="text" placeholder="Message fastverk chat…" autocomplete="off" />',
      '<button class="asst-send" type="submit">Send</button>',
      '</form>',
    ].join('');
    this.logEl = this.querySelector('[data-log]');
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
        this.appendEvent(JSON.parse(msg.data) as HostEvent);
      } catch (e) {
        console.error('assistant-panel: bad SSE frame', e, msg.data);
      }
    };
    this.source.onerror = (e) => {
      console.warn('assistant-panel: SSE error (will retry)', e);
    };
  }

  private appendEvent(ev: HostEvent): void {
    if (this.seen.has(ev.seq)) return;
    this.seen.add(ev.seq);
    const log = this.logEl;
    if (!log) return;
    log.querySelector('.asst-empty')?.remove();

    let html = '';
    if (ev.turnStarted) {
      html = `<div class="asst-row user"><div class="asst-bubble">${esc(ev.turnStarted.message)}</div></div>`;
    } else if (ev.assistantDelta) {
      html = `<div class="asst-row assistant"><div class="asst-bubble">${esc(ev.assistantDelta.text)}</div></div>`;
    } else if (ev.toolCall) {
      const c = ev.toolCall;
      html = `<div class="asst-tool">→ <span class="tool-name">${esc(c.plugin)}·${esc(c.tool)}</span> ${esc(c.argumentsJson)}</div>`;
    } else if (ev.toolResult) {
      const r = ev.toolResult;
      html = `<div class="asst-tool${r.isError ? ' err' : ''}">← ${esc(r.summary)}</div>`;
    } else if (ev.error) {
      html = `<div class="asst-error">⚠ ${esc(ev.error.message)}</div>`;
    } else if (ev.done) {
      if (this.sendEl) this.sendEl.disabled = false;
      return;
    }
    if (html) {
      log.insertAdjacentHTML('beforeend', html);
      log.scrollTo({ top: log.scrollHeight });
    }
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
      // The answer arrives over SSE; `done` re-enables the button.
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
