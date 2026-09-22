// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

describe("TerminalPanel broker admission", () => {
  it("degrades a non-WebSocket broker URL without constructing a terminal or socket", async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
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
});
