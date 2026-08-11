// <m-assistant-panel> — the vanilla (framework-free) conversation renderer: the
// generic MCP-host chat plane. Lifted from meridian-web, now over the shared
// meridian.ui.v1 Conversation wire (conversation.proto — the neutral promotion of
// botnoc chat.v1). The answer is a stream of composable blocks + a transient
// status, not a text blob.
//   turn-url  default `/api/noc-agent/turn` — POST { message }
//   sse-url   default `/api/noc-agent/view` — SSE of ConversationEvent frames
//
// The DOM structure (form.asst-input / input.asst-text / button.asst-send) is
// preserved so hosts that drive the composer externally (botnoc's voice layer,
// which does `panel.querySelector('form.asst-input')` + requestSubmit()) keep
// working unchanged. A cleaner imperative `submit(text?)` is also provided.

import { escHtml as esc } from "./dom.js";
import { renderBlockInner } from "./render_html.js";
import { ASSISTANT_PANEL_CSS } from "./styles.js";
import type { Block, ConversationEvent } from "./wire.js";

export { ASSISTANT_PANEL_CSS };

export class MAssistantPanel extends HTMLElement {
  private source: EventSource | null = null;
  private logEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendEl: HTMLButtonElement | null = null;
  private blocks = new Map<string, HTMLElement>();
  private seen = new Set<number>();

  static get observedAttributes(): string[] {
    return ["sse-url", "turn-url"];
  }
  get sseUrl(): string {
    return this.getAttribute("sse-url") || "/api/noc-agent/view";
  }
  get turnUrl(): string {
    return this.getAttribute("turn-url") || "/api/noc-agent/turn";
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
    if (name === "sse-url" && this.isConnected) {
      this.source?.close();
      this.connectSse();
    }
  }

  private render(): void {
    this.innerHTML = [
      '<div class="asst-log" data-log>',
      '<div class="ctx asst-empty">Ask about your repos, issues, or PRs — I\'ll use the connected tools.</div>',
      '<div class="status" data-status></div>',
      "</div>",
      '<form class="asst-input">',
      '<input class="asst-text" type="text" placeholder="Message fastverk chat…" autocomplete="off" />',
      '<button class="asst-send" type="submit">Send</button>',
      "</form>",
    ].join("");
    this.logEl = this.querySelector("[data-log]");
    this.statusEl = this.querySelector("[data-status]");
    this.inputEl = this.querySelector("input.asst-text");
    this.sendEl = this.querySelector("button.asst-send");
    this.querySelector("form.asst-input")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.send();
    });
  }

  private connectSse(): void {
    this.source = new EventSource(this.sseUrl);
    this.source.onmessage = (msg) => {
      try {
        this.handle(JSON.parse(msg.data) as ConversationEvent);
      } catch (e) {
        console.error("assistant-panel: bad SSE frame", e, msg.data);
      }
    };
    this.source.onerror = (e) => console.warn("assistant-panel: SSE error (will retry)", e);
  }

  private handle(ev: ConversationEvent): void {
    const seq = typeof ev.seq === "number" ? ev.seq : ev.seq != null ? Number(ev.seq) : undefined;
    if (seq !== undefined && !Number.isNaN(seq)) {
      if (this.seen.has(seq)) return;
      this.seen.add(seq);
    }
    if (ev.block) this.upsertBlock(ev.block);
    else if (ev.status) this.renderStatus(ev.status.state || "", ev.status.detail || "");
    else if (ev.done) {
      this.renderStatus("IDLE", "");
      if (this.sendEl) this.sendEl.disabled = false;
    } else if (ev.error) {
      this.appendError(ev.error.message || "");
      this.renderStatus("IDLE", "");
      if (this.sendEl) this.sendEl.disabled = false;
    }
  }

  private upsertBlock(b: Block): void {
    const log = this.logEl;
    if (!log) return;
    log.querySelector(".asst-empty")?.remove();
    const id = b.blockId ?? "";
    let el = this.blocks.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "asst-row " + (b.role === "user" ? "user" : "assistant");
      log.insertBefore(el, this.statusEl);
      this.blocks.set(id, el);
    }
    el.innerHTML = renderBlockInner(b);
    this.scrollDown();
  }

  private appendError(message: string): void {
    const log = this.logEl;
    if (!log) return;
    const el = document.createElement("div");
    el.className = "err";
    el.textContent = "⚠ " + message;
    log.insertBefore(el, this.statusEl);
    this.scrollDown();
  }

  private renderStatus(state: string, detail: string): void {
    const s = this.statusEl;
    if (!s) return;
    if (state === "THINKING") {
      s.innerHTML = 'Thinking<span class="dots"><span>.</span><span>.</span><span>.</span></span>';
      s.className = "status on";
    } else if (state === "WORKING") {
      s.innerHTML = `<span class="spin"></span>${esc(detail || "Working…")}`;
      s.className = "status on";
    } else {
      s.className = "status";
      s.innerHTML = "";
    }
    this.scrollDown();
  }

  private scrollDown(): void {
    this.logEl?.scrollTo({ top: this.logEl.scrollHeight });
  }

  /**
   * Send a message. With no argument, sends the composer's current value (the
   * form-submit path). With `text`, sets the composer to it first — the clean
   * imperative entry point for a host driving the panel (e.g. a voice layer), an
   * alternative to reaching into `input.asst-text` + `form.requestSubmit()`.
   */
  submit(text?: string): void {
    if (text !== undefined && this.inputEl) this.inputEl.value = text;
    void this.send();
  }

  private async send(): Promise<void> {
    const q = this.inputEl?.value.trim();
    if (!q || !this.sendEl) return;
    this.sendEl.disabled = true;
    if (this.inputEl) this.inputEl.value = "";
    this.dispatchEvent(new CustomEvent("turn-sent", { detail: { message: q }, bubbles: true }));
    try {
      const resp = await fetch(this.turnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      if (!resp.ok) {
        console.error("assistant-panel: turn failed", resp.status, await resp.text());
        this.sendEl.disabled = false;
      }
    } catch (e) {
      console.error("assistant-panel: turn error", e);
      this.sendEl.disabled = false;
    } finally {
      this.inputEl?.focus();
    }
  }
}

/** Idempotent registration. Call once at app start. */
export function registerAssistantPanel(): void {
  if (!customElements.get("m-assistant-panel")) {
    customElements.define("m-assistant-panel", MAssistantPanel);
  }
}
