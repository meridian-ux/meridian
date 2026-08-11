// Theme binding — maps a meridian.theme.v1.Theme (the neutral skin) onto a MUI
// theme. Owned by the kit (no @aion/ui dependency): a `ThemeConfig` of design
// tokens → MUI `createTheme`, carrying the aion look (system-ui type, no-shout
// buttons, hairline card borders) so one meridian skin drives the MUI look of
// every panel this kit paints — as it drives the web-components and TUI renderers.

import type { CSSProperties } from "react";

import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";

import type { Palette, Theme, Typography } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

export interface ThemeConfig {
  mode: "light" | "dark";
  primary: { main: string; light: string; dark: string };
  secondary: { main: string };
  background: { default: string; paper: string };
  text: { primary: string; secondary: string };
  border: { card: string; button: string };
  typography: {
    /** UI / body font stack. */
    sans: string;
    /** Heading font stack. Falls back to `sans` for single-face brands. */
    display: string;
    /** Code font stack. */
    mono: string;
    baseSizePx: number;
    headingWeight: number;
    bodyWeight: number;
    /** Heading letter-spacing in em, e.g. "-0.015". */
    headingTracking: string;
  };
  metrics: { radiusPx: number; unitPx: number };
}

// Neutral defaults for any token a Theme leaves unset (proto3 scalars default to
// "" / 0). These are the kit's previous hardcoded values, so a Theme that sets no
// typography or metrics renders exactly as it did before these tokens were bound.
const FALLBACK = {
  bg: "#ffffff",
  surface: "#ffffff",
  fg: "#111111",
  muted: "#6b7280",
  border: "#e0e0e0",
  accent: "#1976d2",
  accentStrong: "#115293",
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  baseSizePx: 14,
  headingWeight: 600,
  bodyWeight: 400,
  headingTracking: "0",
  radiusPx: 4,
  unitPx: 8,
} as const;

const pick = (value: string | undefined, fallback: string): string =>
  value && value.length > 0 ? value : fallback;

// proto3 numeric scalars default to 0, which is never a meaningful size/weight —
// so 0 means "unset", not "zero".
const pickNum = (value: number | undefined, fallback: number): number =>
  value && value > 0 ? value : fallback;

/** One obtainable font file, as `meridian.theme.v1.FontSource`. */
export interface FontSourceView {
  family: string;
  srcUri: string;
  weight: string;
  style: string;
  unicodeRange: string;
  display: string;
}

/**
 * Typography fields that post-date this kit's pinned @savvifi/meridian-proto-ts.
 * Read through ONE cast, here, rather than scattering `as unknown as` at each
 * use: when the pinned package catches up, this shim is the only thing to
 * delete. Both fields are absent-safe — see the fallbacks in `readTypography`.
 */
interface ForwardTypography {
  display?: string;
  fonts?: FontSourceView[];
}

/** Generic CSS font families and system keywords — never things to load or warn about. */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "inherit",
  "initial",
  "unset",
]);

/**
 * The first concrete family named in a CSS font stack — the face the brand
 * actually asks for; everything after it is a deliberate fallback. Returns
 * undefined for a stack that is entirely generic.
 */
export function primaryFamily(stack: string): string | undefined {
  for (const raw of stack.split(",")) {
    const family = raw.trim().replace(/^['"]|['"]$/g, "").trim();
    if (family && !GENERIC_FAMILIES.has(family.toLowerCase())) return family;
  }
  return undefined;
}

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
  const type = theme?.typography;
  const sans = pick(type?.sans, FALLBACK.sans);
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
    typography: {
      sans,
      // Absent ⇒ headings use `sans`, correct for single-face brands.
      display: pick((type as ForwardTypography | undefined)?.display, sans),
      mono: pick(type?.mono, FALLBACK.mono),
      baseSizePx: pickNum(type?.baseSizePx, FALLBACK.baseSizePx),
      headingWeight: pickNum(type?.headingWeight, FALLBACK.headingWeight),
      bodyWeight: pickNum(type?.bodyWeight, FALLBACK.bodyWeight),
      headingTracking: pick(type?.headingTracking, FALLBACK.headingTracking),
    },
    metrics: {
      radiusPx: pickNum(theme?.metrics?.radiusPx, FALLBACK.radiusPx),
      unitPx: pickNum(theme?.metrics?.unitPx, FALLBACK.unitPx),
    },
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
      fontFamily: config.typography.sans,
      fontSize: config.typography.baseSizePx,
      fontWeightRegular: config.typography.bodyWeight,
      fontWeightMedium: config.typography.headingWeight,
      // Headings take the skin's DISPLAY face, which is `sans` unless the brand
      // pairs a distinct one. This is what lets a serif/sans identity survive
      // into the rendered UI instead of collapsing to a single face.
      ...Object.fromEntries(
        (["h1", "h2", "h3", "h4", "h5", "h6", "subtitle1", "subtitle2"] as const).map(
          (variant) => [
            variant,
            {
              fontFamily: config.typography.display,
              fontWeight: config.typography.headingWeight,
              letterSpacing: `${config.typography.headingTracking}em`,
            },
          ],
        ),
      ),
    },
    shape: { borderRadius: config.metrics.radiusPx },
    spacing: config.metrics.unitPx,
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

/** The font sources a skin declares (empty when it ships none). */
export function themeFontSources(theme: Theme | undefined): FontSourceView[] {
  return (theme?.typography as ForwardTypography | undefined)?.fonts ?? [];
}

// A skin is trusted configuration, not user input — but it is DATA, and data
// flowing into a stylesheet gets escaped. `url(...)` and `"..."` both terminate
// on characters a malformed (or hostile) skin could carry, so anything that
// could close the context is stripped rather than trusted to be well-formed.
// Tolerates undefined on purpose: proto3-JSON OMITS default values, and the web
// path loads skins as JSON (brando emits <brand>.json beside the binpb), so a
// source with weight "" arrives with no `weight` key at all.
const cssSafe = (value: string | undefined): string =>
  (value ?? "").replace(/["'()\\\r\n;{}]/g, "").trim();

const FORMAT_BY_EXT: Record<string, string> = {
  woff2: "woff2",
  woff: "woff",
  ttf: "truetype",
  otf: "opentype",
};

/** Guess the CSS `format(...)` hint from a source URI's extension. */
function fontFormat(srcUri: string): string | undefined {
  const ext = srcUri.split("?")[0]?.split("#")[0]?.split(".").pop()?.toLowerCase();
  return ext ? FORMAT_BY_EXT[ext] : undefined;
}

/**
 * The skin's declared faces as `@font-face` CSS.
 *
 * This is what lets a skin keep its own promise. Without it a stack naming
 * "Quicksand" renders in whatever the host happens to have loaded, and a brand
 * silently does not apply. Emitting the sources the skin declares makes the
 * named face actually available.
 *
 * Returns "" when the skin declares no sources, so hosts that load fonts
 * themselves are unaffected.
 */
export function themeProtoToFontFaceCss(theme: Theme | undefined): string {
  return themeFontSources(theme)
    .filter((font) => font.family && font.srcUri)
    .map((font) => {
      const format = fontFormat(font.srcUri);
      const src = `url("${cssSafe(font.srcUri)}")${format ? ` format("${format}")` : ""}`;
      const lines = [
        `  font-family: "${cssSafe(font.family)}";`,
        `  src: ${src};`,
        `  font-weight: ${cssSafe(font.weight) || "400"};`,
        `  font-style: ${cssSafe(font.style) || "normal"};`,
        // `swap` keeps text readable while the face loads, rather than blocking
        // paint on a webfont — an invisible-text FOIT is worse than a reflow.
        `  font-display: ${cssSafe(font.display) || "swap"};`,
      ];
      const range = cssSafe(font.unicodeRange);
      if (range) lines.push(`  unicode-range: ${range};`);
      return `@font-face {\n${lines.join("\n")}\n}`;
    })
    .join("\n");
}

/**
 * Families the skin ASKS FOR but the browser cannot resolve — i.e. the cases
 * where the brand is silently not being applied.
 *
 * Only the PRIMARY family of each stack is checked: everything after it is a
 * deliberate fallback, so warning about those would be noise. Returns [] when
 * the Font Loading API is unavailable (SSR, jsdom), since absence of evidence
 * is not evidence of a missing font.
 */
export function missingThemeFonts(theme: Theme | undefined): string[] {
  const fonts: FontFaceSet | undefined =
    typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.check !== "function") return [];
  // Only what the SKIN declared — never the kit's own fallback stack. Those
  // fallbacks name platform faces on purpose ("Segoe UI", "SFMono-Regular"),
  // exactly one of which resolves on any given OS, so judging them would warn
  // on every machine about a font that was never promised.
  const type = theme?.typography as (Typography & ForwardTypography) | undefined;
  const wanted = [type?.sans, type?.display, type?.mono].filter(
    (stack): stack is string => typeof stack === "string" && stack.length > 0,
  );
  const missing = new Set<string>();
  for (const stack of wanted) {
    const family = primaryFamily(stack);
    if (!family) continue;
    try {
      // `check` throws on a font shorthand it cannot parse; a family we cannot
      // even ask about is not a family we should warn about.
      if (!fonts.check(`16px "${family}"`)) missing.add(family);
    } catch {
      /* unparseable family — ignore rather than cry wolf */
    }
  }
  return [...missing];
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
  const config = themeProtoToThemeConfig(theme, mode);
  const vars: Record<string, string> = {
    "--mer-bg": pick(palette.bg, FALLBACK.bg),
    "--mer-surface": pick(palette.surface, FALLBACK.surface),
    "--mer-fg": pick(palette.fg, FALLBACK.fg),
    "--mer-muted": pick(palette.muted ?? palette.fg, FALLBACK.muted),
    "--mer-border": pick(palette.border, FALLBACK.border),
    "--mer-accent": pick(palette.accent, FALLBACK.accent),
    // Type + metrics, so the kit-neutral chrome matches the panels the kit paints
    // rather than silently falling back to the host page's font.
    "--mer-sans": config.typography.sans,
    "--mer-display": config.typography.display,
    "--mer-mono": config.typography.mono,
    "--mer-base-size": `${config.typography.baseSizePx}px`,
    "--mer-heading-weight": String(config.typography.headingWeight),
    "--mer-body-weight": String(config.typography.bodyWeight),
    "--mer-heading-tracking": `${config.typography.headingTracking}em`,
    "--mer-radius": `${config.metrics.radiusPx}px`,
    "--mer-unit": `${config.metrics.unitPx}px`,
  };
  return vars as CSSProperties;
}
