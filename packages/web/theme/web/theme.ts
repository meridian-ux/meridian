// meridian web theme binding — maps a Theme (meridian.theme.v1) to the
// `--mer-*` CSS custom properties that meridian.css consumes. This is the web
// half of meridian's orthogonal style layer: the renderer emits style-free
// `.meridian-uiview-*` DOM, meridian.css styles it purely through these vars,
// and a Theme sets the vars. One Theme drives every renderer; this is its web
// expression.
//
// The shapes below mirror the proto (meridian.theme.v1) — kept as a hand
// interface because the web surface decodes via the wasm bundle and does not
// generate TS proto types. If the proto changes, change these in lockstep.

import { resolveMetrics } from "@savvifi/meridian-schemas/theme";

export interface Palette {
  bg?: string;
  surface?: string;
  fg?: string;
  muted?: string;
  border?: string;
  accent?: string;
  accent_strong?: string;
  on_accent?: string;
  danger?: string;
  success?: string;
  code_bg?: string;
  code_fg?: string;
}

export interface Typography {
  sans?: string;
  mono?: string;
  base_size_px?: number;
  heading_weight?: number;
  body_weight?: number;
  heading_tracking?: string;
}

export interface Metrics {
  radius_px?: number;
  unit_px?: number;
  spacing_scale_px?: number[];
  density_scale?: number;
  stroke_px?: number;
}

export interface Theme {
  id?: string;
  display_name?: string;
  light?: Palette;
  dark?: Palette;
  typography?: Typography;
  metrics?: Metrics;
}

export type Mode = "light" | "dark";

const PALETTE_VARS: ReadonlyArray<readonly [keyof Palette, string]> = [
  ["bg", "--mer-bg"],
  ["surface", "--mer-surface"],
  ["fg", "--mer-fg"],
  ["muted", "--mer-muted"],
  ["border", "--mer-border"],
  ["accent", "--mer-accent"],
  ["accent_strong", "--mer-accent-strong"],
  ["on_accent", "--mer-on-accent"],
  ["danger", "--mer-danger"],
  ["success", "--mer-success"],
  ["code_bg", "--mer-code-bg"],
  ["code_fg", "--mer-code-fg"],
];

/** Resolve the palette for a mode, falling back to `light` when `dark` is unset. */
export function paletteFor(theme: Theme, mode: Mode): Palette {
  return (mode === "dark" ? theme.dark : theme.light) ?? theme.light ?? {};
}

/** Build the `--mer-*` declarations for a theme + mode as `prop: value;` lines. */
export function themeToCssVars(theme: Theme, mode: Mode = "dark"): Record<string, string> {
  const vars: Record<string, string> = {};
  const pal = paletteFor(theme, mode);
  for (const [key, cssVar] of PALETTE_VARS) {
    const v = pal[key];
    if (v) vars[cssVar] = v;
  }
  const t = theme.typography;
  if (t) {
    if (t.sans) vars["--mer-font-sans"] = t.sans;
    if (t.mono) vars["--mer-font-mono"] = t.mono;
    if (t.base_size_px) vars["--mer-font-size"] = `${t.base_size_px}px`;
    if (t.heading_weight) vars["--mer-heading-weight"] = String(t.heading_weight);
    if (t.body_weight) vars["--mer-body-weight"] = String(t.body_weight);
    if (t.heading_tracking) vars["--mer-heading-tracking"] = `${t.heading_tracking}em`;
  }
  const m = theme.metrics;
  if (m) {
    if (m.radius_px) vars["--mer-radius"] = `${m.radius_px}px`;
    if (m.unit_px) vars["--mer-unit"] = `${m.unit_px}px`;
    const resolved = resolveMetrics({ unitPx: m.unit_px, spacingScalePx: m.spacing_scale_px,
      densityScale: m.density_scale, strokePx: m.stroke_px }, 4);
    // Emit only for an opt-in Metrics addition; legacy host-unit overrides keep
    // their CSS fallback behavior when no scale or density was supplied.
    if (resolved.hasSpacing) {
      for (const factor of [1, 1.5, 2, 3, 3.5, 4, 5, 6])
        vars[`--mer-space-${String(factor).replace(".", "-")}`] = `${resolved.spacing(factor)}px`;
    }
    if (resolved.strokePx !== undefined) vars["--mer-stroke"] = `${resolved.strokePx}px`;
  }
  return vars;
}

/** Render a `:root { ... }` (or custom selector) CSS block — for static skins. */
export function themeToCss(theme: Theme, mode: Mode = "dark", selector = ":root"): string {
  const vars = themeToCssVars(theme, mode);
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}\n`;
}

// Runtime ownership only; these declarations never cross a serialized boundary.
type Declaration = { value: string; priority: string };
type OwnedDeclaration = { before: Declaration; applied: Declaration };
const appliedThemes = new WeakMap<HTMLElement, Map<string, OwnedDeclaration>>();
const declaration = (el: HTMLElement, key: string): Declaration => ({
  value: el.style.getPropertyValue(key), priority: el.style.getPropertyPriority(key),
});
const sameDeclaration = (a: Declaration, b: Declaration): boolean =>
  a.value === b.value && a.priority === b.priority;

/** Apply a complete theme snapshot (default :root). Omitted tokens restore the
 * pre-theme host declaration or stylesheet fallback; external edits survive. */
export function applyTheme(
  theme: Theme,
  mode: Mode = "dark",
  el: HTMLElement = document.documentElement,
): void {
  const next = themeToCssVars(theme, mode);
  const previous = appliedThemes.get(el) ?? new Map<string, OwnedDeclaration>();
  for (const [key, owned] of previous) {
    if (Object.hasOwn(next, key) || !sameDeclaration(declaration(el, key), owned.applied)) continue;
    if (owned.before.value) el.style.setProperty(key, owned.before.value, owned.before.priority);
    else el.style.removeProperty(key);
  }
  const managed = new Map<string, OwnedDeclaration>();
  for (const [key, value] of Object.entries(next)) {
    const current = declaration(el, key), owned = previous.get(key);
    const before = owned && sameDeclaration(current, owned.applied) ? owned.before : current;
    el.style.setProperty(key, value);
    managed.set(key, { before, applied: declaration(el, key) });
  }
  if (managed.size) appliedThemes.set(el, managed);
  else appliedThemes.delete(el);
}
