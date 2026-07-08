// TerminalPanel renderer — an interactive xterm.js terminal spliced to a remote
// pty over a WebSocket.
//
// This is a pure JS/TS surface (no wasm), like the chat panel: xterm renders in
// the browser and a WebSocket carries the pty bytes. The wire protocol is
// deliberately tiny and is the contract with the pod-side tty-broker:
//   • Binary frames  = raw pty bytes, both directions (stdin up, stdout down).
//   • Text  frames   = JSON control. Browser→broker: {"type":"resize",cols,rows}.
//                      Broker→browser: {"type":"exit","code":N} (optional).
// The transport is gated upstream (ws-proxy validates the session + ownership
// and only then upgrades), so the descriptor carries no credential — the
// browser's same-site cookie rides the WebSocket handshake.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { TERMINAL_PANEL_CSS } from "./terminal_panel_css.js";

export { TERMINAL_PANEL_CSS };

/** What to connect to. `url` is already fully resolved (placeholders filled). */
export interface TerminalSpec {
  /** ws:// or wss:// URL of the pty broker. */
  url: string;
  /** Tool id for the status header + telemetry (e.g. "bash", "opencode"). */
  tool?: string;
  /** Pre-fit dimensions; 0/undefined → xterm defaults, then FitAddon fits. */
  cols?: number;
  rows?: number;
}

/** Handle returned by `renderTerminalPanel` so hosts can tear a session down. */
export interface TerminalHandle {
  dispose(): void;
}

const CSS_MARKER = "data-meridian-terminal-css";

/** Inject the vendored xterm + wrapper CSS once per document (idempotent). */
export function injectTerminalCss(doc: Document = document): void {
  if (doc.head.querySelector(`style[${CSS_MARKER}]`)) return;
  const style = doc.createElement("style");
  style.setAttribute(CSS_MARKER, "");
  style.textContent = TERMINAL_PANEL_CSS;
  doc.head.appendChild(style);
}

/**
 * Mount an interactive terminal into `root` and connect it to `spec.url`.
 *
 * Handles fit-to-container (initial + on resize), keystroke → pty, pty → screen,
 * a resize control frame, and reconnect after the session closes. Returns a
 * handle whose `dispose()` closes the socket and frees the terminal.
 */
export function renderTerminalPanel(
  root: HTMLElement,
  spec: TerminalSpec,
): TerminalHandle {
  injectTerminalCss(root.ownerDocument ?? document);
  root.replaceChildren();

  // Status line: a dot + label + a reconnect button (shown once closed).
  const status = document.createElement("div");
  status.className = "meridian-uiview-terminal-status";
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.textContent = spec.tool ? `${spec.tool} — connecting…` : "connecting…";
  const reconnect = document.createElement("button");
  reconnect.className = "meridian-uiview-terminal-reconnect";
  reconnect.textContent = "Reconnect";
  reconnect.style.display = "none";
  status.append(dot, label, reconnect);

  const screen = document.createElement("div");
  screen.className = "meridian-uiview-terminal";

  root.append(status, screen);

  const term = new Terminal({
    cols: spec.cols || 80,
    rows: spec.rows || 24,
    cursorBlink: true,
    convertEol: false,
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    theme: { background: "#0b0c0f", foreground: "#ECE7DA" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(screen);
  safeFit();

  let ws: WebSocket | null = null;
  let disposed = false;

  const setStatus = (text: string, state: "" | "connected" | "closed") => {
    label.textContent = spec.tool ? `${spec.tool} — ${text}` : text;
    status.className = `meridian-uiview-terminal-status${state ? " " + state : ""}`;
  };

  function safeFit(): void {
    try {
      fit.fit();
    } catch {
      /* container not laid out yet; a later ResizeObserver tick will fit. */
    }
  }

  function sendResize(): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  }

  const ro = new ResizeObserver(() => {
    safeFit();
  });
  ro.observe(screen);

  const onData = term.onData((data: string) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(new TextEncoder().encode(data));
    }
  });
  const onResize = term.onResize(() => sendResize());

  function connect(): void {
    if (disposed) return;
    reconnect.style.display = "none";
    setStatus("connecting…", "");
    let sock: WebSocket;
    try {
      sock = new WebSocket(spec.url);
    } catch (err) {
      setStatus(`connect failed: ${(err as Error).message}`, "closed");
      reconnect.style.display = "";
      return;
    }
    sock.binaryType = "arraybuffer";
    ws = sock;

    sock.onopen = () => {
      setStatus("connected", "connected");
      safeFit();
      sendResize();
      term.focus();
    };
    sock.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        // JSON control frame from the broker (e.g. exit notice). Best-effort.
        try {
          const msg = JSON.parse(ev.data) as { type?: string; code?: number };
          if (msg.type === "exit") {
            term.write(`\r\n\x1b[90m[process exited${
              msg.code != null ? ` (${msg.code})` : ""
            }]\x1b[0m\r\n`);
          }
        } catch {
          /* not JSON — ignore. */
        }
        return;
      }
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    sock.onclose = () => {
      if (disposed) return;
      ws = null;
      setStatus("disconnected", "closed");
      reconnect.style.display = "";
    };
    sock.onerror = () => {
      // onclose fires next; surface a hint in the meantime.
      setStatus("connection error", "closed");
    };
  }

  reconnect.onclick = () => connect();
  connect();

  return {
    dispose(): void {
      disposed = true;
      ro.disconnect();
      onData.dispose();
      onResize.dispose();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closing. */
        }
        ws = null;
      }
      term.dispose();
      root.replaceChildren();
    },
  };
}
