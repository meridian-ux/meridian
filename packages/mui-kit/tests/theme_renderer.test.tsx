import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { Box } from "@mui/material";
import { useTheme, type Theme as MuiTheme } from "@mui/material/styles";
import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ThemeSchema } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { PanelHandle } from "@savvifi/meridian-schemas/uiview";
import { PanelRenderer, reactWebRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "../src/mui_kit.js";
import { MeridianMuiProvider } from "../src/provider.js";

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
const invoker = { invoke: vi.fn(async () => ({})) };
const descriptor = create(PanelDescriptorSchema, { panelId: "theme-probe", body: {
  case: "adhoc", value: { handlerId: "probe" },
} });
const skin = create(ThemeSchema, {
  light: { bg: "#102030", surface: "#203040" }, dark: { bg: "#506070", surface: "#607080" },
  metrics: { radiusPx: 12, spacingScalePx: [0, 2, 6, 12], densityScale: 0.75, strokePx: 0 },
  typography: { baseSizePx: 19, bodyWeight: 500, headingWeight: 700 },
});

it("binds the documented reactWebRenderer(muiKit) Theme through a real MUI provider", async () => {
  const container = document.createElement("main"); document.body.append(container);
  container.style.setProperty("--mer-space-1", "17px");
  let observed: MuiTheme | undefined, handle: PanelHandle | undefined;
  function Probe() {
    observed = useTheme();
    const [count, setCount] = useState(0);
    return <Box data-testid="probe" sx={{ p: 1.5, bgcolor: "background.paper", borderRadius: 1 }}>
      <button onClick={() => setCount(value => value + 1)}>Count {count}</button>
    </Box>;
  }
  try {
    await act(async () => { handle = await reactWebRenderer(muiKit).mount({ container, descriptor,
      theme: skin, invoker, adhoc: { probe: Probe } }); });
    expect(observed!.spacing(1.5)).toBe("3px");
    expect(observed!.shape.borderRadius).toBe(12);
    expect(observed!.typography.fontSize).toBe(19);
    expect(observed!.palette.mode).toBe("light");
    expect(container.querySelector(".MuiScopedCssBaseline-root")).not.toBeNull();
    const probe = container.querySelector<HTMLElement>('[data-testid="probe"]')!;
    expect(getComputedStyle(probe).padding).toBe("3px");
    expect(getComputedStyle(probe).backgroundColor).toBe("rgb(32, 48, 64)");
    const button = probe.querySelector("button")!;
    await act(async () => button.click());
    await act(async () => { await handle!.update(create(PanelDescriptorSchema, { ...descriptor, title: "Updated" })); });
    expect(container.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("Count 1");
    await act(async () => handle!.unmount()); handle = undefined;
    expect(container.children.length).toBe(0);
    expect(container.style.getPropertyValue("--mer-space-1")).toBe("17px");
  } finally { if (handle) await act(async () => handle!.unmount()); container.remove(); }
});

it("retains explicit dark mode in MeridianMuiProvider without a second light boundary", async () => {
  const container = document.createElement("main"); document.body.append(container);
  const root = createRoot(container);
  let observed: MuiTheme | undefined;
  function Probe() { observed = useTheme(); return <Box data-testid="dark-probe" sx={{ bgcolor: "background.paper" }}>Dark</Box>; }
  try {
    await act(async () => root.render(createElement(MeridianMuiProvider, { invoker, theme: skin, mode: "dark",
      adhoc: { probe: Probe }, children: createElement(PanelRenderer, { descriptor }) })));
    expect(observed!.palette.mode).toBe("dark");
    expect(getComputedStyle(container.querySelector<HTMLElement>('[data-testid="dark-probe"]')!).backgroundColor).toBe("rgb(96, 112, 128)");
    expect(observed!.spacing(1.5)).toBe("3px");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
