// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const dataHandlers: Array<(data: string) => void> = [];

vi.mock("@xterm/xterm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xterm/xterm")>();
  return {
    ...actual,
    Terminal: class extends actual.Terminal {
      constructor(options: ConstructorParameters<typeof actual.Terminal>[0]) {
        super(options);
        Object.defineProperty(this, "onData", {
          configurable: true,
          value: (handler: (data: string) => void) => {
            dataHandlers.push(handler);
            return { dispose() {} };
          },
        });
      }
    },
  };
});

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  binaryType = "";
  sent: Array<string | Uint8Array> = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) { MockWebSocket.instances.push(this); }
  send(payload: string | Uint8Array): void { this.sent.push(payload); }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed.push({ code, reason });
  }
  receive(data: string | ArrayBuffer): void { this.onmessage?.({ data } as MessageEvent); }
  open(): void { this.onopen?.(); }
}

const originalWebSocket = globalThis.WebSocket;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  window.matchMedia = originalMatchMedia;
  MockWebSocket.instances = [];
  dataHandlers.length = 0;
  document.head.querySelectorAll("style[data-meridian-terminal-css]").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

function installTerminalBrowserMocks(): void {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
  window.matchMedia = (() => ({
    matches: false, media: "", onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  })) as typeof window.matchMedia;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
}

describe("TerminalPanel broker admission", () => {
  it("degrades a non-WebSocket broker URL without constructing a terminal or socket", async () => {
    installTerminalBrowserMocks();
    const { renderTerminalPanel } = await import("../src/terminal_panel.js");
    const root = document.createElement("div");
    const handle = renderTerminalPanel(root, {
      url: "javascript:alert(1)",
      tool: "Build shell",
      createBudget: () => ({ admit: () => 0 }),
    });

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "expected a ws:// or wss:// broker URL",
    );
    expect(root.querySelector("code")?.textContent).toBe("javascript:alert(1)");
    expect(root.querySelector(".meridian-uiview-terminal")).toBeNull();
    expect(() => handle.dispose()).not.toThrow();
  });

  it("closes the inbound session before writing a frame rejected by its budget", async () => {
    installTerminalBrowserMocks();
    const { renderTerminalPanel } = await import("../src/terminal_panel.js");
    const admit = vi.fn((bytes: number) => bytes > 4 ? 1 : 0);
    const root = document.createElement("div");
    renderTerminalPanel(root, {
      url: "wss://broker.example.test/pty",
      createBudget: () => ({ admit }),
    });

    const socket = MockWebSocket.instances[0];
    socket.receive(new Uint8Array([1, 2, 3, 4, 5]).buffer);

    expect(admit).toHaveBeenCalledWith(5, expect.any(Number));
    expect(socket.closed).toEqual([{ code: 1009, reason: "payload limit exceeded" }]);
    expect(root.querySelector(".meridian-uiview-terminal-status")?.textContent).toContain("payload limit exceeded");
  });

  it("rejects outbound input before sending and creates fresh direction budgets on reconnect", async () => {
    installTerminalBrowserMocks();
    const created: Array<ReturnType<typeof vi.fn>> = [];
    const { renderTerminalPanel } = await import("../src/terminal_panel.js");
    const root = document.createElement("div");
    const handle = renderTerminalPanel(root, {
      url: "wss://broker.example.test/pty",
      createBudget: () => {
        const admit = vi.fn((bytes: number) => bytes > 3 ? 1 : 0);
        created.push(admit);
        return { admit };
      },
    });

    const first = MockWebSocket.instances[0];
    dataHandlers[0]("abcd");
    expect(first.sent).toEqual([]);
    expect(first.closed).toEqual([{ code: 1009, reason: "payload limit exceeded" }]);
    expect(created).toHaveLength(4);

    root.querySelector<HTMLButtonElement>(".meridian-uiview-terminal-reconnect")?.click();
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(created).toHaveLength(6);
    handle.dispose();
  });
});
