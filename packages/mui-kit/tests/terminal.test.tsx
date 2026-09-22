import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { TerminalPanelSchema } from "@savvifi/meridian-proto-ts/proto/terminal_pb.js";
import { MeridianProvider, PanelRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";

afterEach(cleanup);

describe("MUI TerminalPanel", () => {
  it("renders an accessible connection shell and terminal dimensions", () => {
    render(<MeridianProvider invoker={{ invoke: async () => ({}) }} kit={muiKit} adhoc={{}}>
      <PanelRenderer descriptor={create(PanelDescriptorSchema, {
        title: "Shell",
        body: { case: "terminal", value: create(TerminalPanelSchema, { tool: "Build shell", url: "wss://example.test/pty", cols: 120, rows: 30 }) },
      })} />
    </MeridianProvider>);
    expect(screen.getByRole("region", { name: "Build shell" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "wss://example.test/pty" })).toBeTruthy();
    expect(screen.getByText("120 × 30")).toBeTruthy();
  });

  it("preserves a rejected broker URL as inert diagnostic text", () => {
    render(<MeridianProvider invoker={{ invoke: async () => ({}) }} kit={muiKit} adhoc={{}}>
      <PanelRenderer descriptor={create(PanelDescriptorSchema, {
        title: "Shell",
        body: { case: "terminal", value: create(TerminalPanelSchema, {
          tool: "Build shell",
          url: "https://example.test/not-a-websocket",
        }) },
      })} />
    </MeridianProvider>);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("https://example.test/not-a-websocket").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("expected a ws:// or wss:// broker URL");
  });
});
