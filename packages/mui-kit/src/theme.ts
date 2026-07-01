// Theme binding — maps a meridian.theme.v1.Theme (the neutral skin) onto a MUI
// theme. Owned by the kit (no @aion/ui dependency): a `ThemeConfig` of design
// tokens → MUI `createTheme`, carrying the aion look (system-ui type, no-shout
// buttons, hairline card borders) so one meridian skin drives the MUI look of
// every panel this kit paints — as it drives the web-components and TUI renderers.

import type { CSSProperties } from "react";

import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";

import type { Palette, Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

export interface ThemeConfig {
  mode: "light" | "dark";
  primary: { main: string; light: string; dark: string };
  secondary: { main: string };
  background: { default: string; paper: string };
  text: { primary: string; secondary: string };
  border: { card: string; button: string };
}

// Neutral defaults for any token a Theme leaves unset (proto3 strings default "").
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

/** Map a meridian Theme (+ mode) to a MUI-shaped ThemeConfig of design tokens. */
export function themeProtoToThemeConfig(
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

/** Build a MUI theme from a ThemeConfig (the lifted `createStudioTheme`). */
export function createMuiThemeFromConfig(config: ThemeConfig): MuiTheme {
  return createTheme({
    palette: {
      mode: config.mode,
      primary: config.primary,
      secondary: config.secondary,
      background: config.background,
      text: config.text,
    },
    typography: {
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    components: {
      MuiButton: { styleOverrides: { root: { textTransform: "none" } } },
      MuiCard: {
        styleOverrides: {
          root: { border: `1px solid ${config.border.card}`, boxShadow: "none" },
        },
      },
    },
  });
}

/** Build a ready-to-use MUI theme directly from a meridian Theme. */
export function themeProtoToMuiTheme(
  theme: Theme | undefined,
  mode: "light" | "dark" = "light",
): MuiTheme {
  return createMuiThemeFromConfig(themeProtoToThemeConfig(theme, mode));
}

/**
 * The meridian palette as the `--mer-*` CSS custom properties that ViewRenderer's
 * kit-neutral layout chrome (the tab strip, etc.) reads. Applied by
 * MeridianMuiProvider so the layout affordances pick up the active skin — the
 * same variables the web-components / html renderers use, so one skin styles all.
 */
export function themeProtoToCssVars(
  theme: Theme | undefined,
  mode: "light" | "dark" = "light",
): CSSProperties {
  const palette: Partial<Palette> =
    (mode === "dark" ? theme?.dark : theme?.light) ?? theme?.light ?? {};
  const vars: Record<string, string> = {
    "--mer-bg": pick(palette.bg, FALLBACK.bg),
    "--mer-surface": pick(palette.surface, FALLBACK.surface),
    "--mer-fg": pick(palette.fg, FALLBACK.fg),
    "--mer-muted": pick(palette.muted ?? palette.fg, FALLBACK.muted),
    "--mer-border": pick(palette.border, FALLBACK.border),
    "--mer-accent": pick(palette.accent, FALLBACK.accent),
  };
  return vars as CSSProperties;
}
