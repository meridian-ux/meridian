// Theme binding — maps a meridian.theme.v1.Theme (the neutral skin) onto the
// aion MUI theme (@aion/ui's ThemeConfig → createStudioTheme). One meridian
// skin (e.g. the savvi brand in aion/brand) therefore drives the MUI look of
// every panel this kit paints, exactly as it drives the web-components and TUI
// renderers.

import { createStudioTheme, type ThemeConfig } from "@aion/ui/theme/themes";
import type { Theme as MuiTheme } from "@mui/material/styles";
import type { Palette, Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

// Sensible neutral defaults for any token a Theme leaves unset (proto3 string
// fields default to ""), so a partial or absent Theme still yields a valid MUI theme.
const FALLBACK = {
  bg: "#ffffff",
  surface: "#ffffff",
  fg: "#111111",
  muted: "#6b7280",
  border: "#e0e0e0",
  accent: "#1976d2",
  accentStrong: "#115293",
} as const;

const pick = (value: string | undefined, fallback: string): string =>
  value && value.length > 0 ? value : fallback;

/**
 * Map a meridian Theme (+ desired light/dark mode) to @aion/ui's `ThemeConfig`.
 * `dark` is optional in the proto; when a caller requests dark mode but the
 * Theme has no dark palette, it falls back to the light palette (per theme.proto).
 */
export function themeProtoToStudioConfig(
  theme: Theme | undefined,
  mode: "light" | "dark" = "light",
): ThemeConfig {
  const palette: Partial<Palette> =
    (mode === "dark" ? theme?.dark : theme?.light) ?? theme?.light ?? {};
  const accent = pick(palette.accent, FALLBACK.accent);
  const accentStrong = pick(palette.accentStrong ?? palette.accent, FALLBACK.accentStrong);
  const border = pick(palette.border, FALLBACK.border);
  return {
    mode,
    primary: { main: accent, light: accent, dark: accentStrong },
    secondary: { main: accentStrong },
    background: {
      default: pick(palette.bg, FALLBACK.bg),
      paper: pick(palette.surface, FALLBACK.surface),
    },
    text: {
      primary: pick(palette.fg, FALLBACK.fg),
      secondary: pick(palette.muted ?? palette.fg, FALLBACK.muted),
    },
    border: { card: border, button: border },
  };
}

/** Build a ready-to-use MUI theme from a meridian Theme. */
export function themeProtoToMuiTheme(
  theme: Theme | undefined,
  mode: "light" | "dark" = "light",
): MuiTheme {
  return createStudioTheme(themeProtoToStudioConfig(theme, mode));
}
