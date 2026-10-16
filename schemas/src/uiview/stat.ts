// Shared StatPanel computation — the ONE TypeScript implementation of a KPI
// tile's delta / trend / formatting, imported by every TS renderer (web-react's
// html/shadcn kits, mui-kit, and the web-components renderer) so none diverge.
// Numeric labels delegate to the same Rust formatter used by the TUI. Trend,
// semantic emphasis, and SVG geometry remain runtime presentation adapters.
//
// The delta/trend is COMPUTED from the data (previous / series), never trusted
// from an author-marked direction — that catches a declining metric mislabeled
// "up". `trend_override` / `delta_override` are escape hatches only. Semantic
// good/bad color is applied ONLY when `higher_is_better` is explicitly set.
//
// Both legacy and declared numeric labels execute in core, not JavaScript twins.

import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { ValueDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import { formatByDisplay } from "./value_display.js";
import { coreFormatting } from "./core_runtime.js";

export type StatTrend = "up" | "down" | "flat" | "none";
export type StatSemantics = "good" | "bad" | "neutral";

export interface StatComputed {
  /** The formatted value + unit suffix (e.g. "1,234 employees", "87.5%"). */
  formattedValue: string;
  /** Computed (or overridden) trend direction; "none" when there is no delta. */
  trend: StatTrend;
  /** Formatted signed delta (e.g. "+30", "-5.0%"), or null when there is none. */
  formattedDelta: string | null;
  /** good/bad ONLY when higher_is_better is set; otherwise neutral. */
  semantics: StatSemantics;
  /** The series (oldest→newest) driving an optional sparkline; [] when <2 points. */
  series: number[];
}

/** Format a raw number per a ValueFormat enum value. Deterministic. */
export function formatStatNumber(n: number, format: number): string {
  return coreFormatting.formatStatNumber(n, format);
}

/** StatPanel carries doubles; only numeric declarations replace its legacy format. */
function numericDisplay(display: ValueDisplay | undefined): ValueDisplay | undefined {
  return display && [ValueType.INTEGER, ValueType.DECIMAL, ValueType.MONEY, ValueType.PERCENT]
    .includes(display.type) ? display : undefined;
}

/** The arrow glyph for a trend (shared so web + tui match). */
export function trendArrow(trend: StatTrend): string {
  return trend === "up" ? "↑" : trend === "down" ? "↓" : trend === "flat" ? "→" : "";
}

/**
 * SVG `<polyline>` points for a sparkline over a width×height box (y-inverted so
 * higher = up). One geometry impl shared by every web kit (html / shadcn / mui /
 * web-components) — drawn by hand, no chart library. "" when < 2 points.
 */
export function statSparklinePoints(series: number[], width = 100, height = 24): string {
  if (series.length < 2) return "";
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = hi - lo || 1;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * width;
      const y = height - ((v - lo) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function mapTrend(override: number): StatTrend {
  return override === 1 ? "up" : override === 2 ? "down" : override === 3 ? "flat" : "none";
}

/** Compute value/delta/trend/semantics, optionally overlaying a populate response.
 * Only finite numeric fields replace authored numbers; display_field overrides
 * only the visible value. Direction remains computed, and inputs stay intact. */
export function computeStat(authored: StatPanel, fetched?: object): StatComputed {
  const at = (path: string): unknown => path.split(".").reduce<unknown>((value, part) =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, fetched);
  const numberAt = (path: string): number | undefined => {
    const value = at(path);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const rawSeries = fetched ? at(authored.seriesField || "series") : undefined;
  const panel = fetched ? {
    ...authored,
    value: numberAt(authored.valueField || "value") ?? authored.value,
    previous: numberAt(authored.previousField || "previous") ?? authored.previous,
    series: Array.isArray(rawSeries) ? rawSeries.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : authored.series,
  } : authored;
  const displayText = fetched && authored.displayField ? at(authored.displayField) : undefined;
  const display = numericDisplay(panel.valueDisplay);
  const unitSuppressed = display
    ? display.type === ValueType.PERCENT || display.type === ValueType.MONEY
    : panel.format === 2 || panel.format === 3;
  const formatValue = (value: number) =>
    display ? formatByDisplay(value, display).text : formatStatNumber(value, panel.format);
  const unitSuffix = panel.unit && !unitSuppressed ? ` ${panel.unit}` : "";
  const formattedValue = typeof displayText === "string" && displayText !== ""
    ? displayText : formatValue(panel.value) + unitSuffix;

  // Raw delta: value − previous, else last − first of series.
  let raw: number | undefined;
  if (panel.previous !== undefined) raw = panel.value - panel.previous;
  else if (panel.series.length >= 2) raw = panel.series[panel.series.length - 1] - panel.series[0];

  const computedTrend: StatTrend =
    raw === undefined ? "none" : raw > 0 ? "up" : raw < 0 ? "down" : "flat";
  const trend = panel.trendOverride !== 0 ? mapTrend(panel.trendOverride) : computedTrend;

  let formattedDelta: string | null = null;
  if (panel.deltaOverride !== undefined) formattedDelta = panel.deltaOverride;
  else if (raw !== undefined)
    formattedDelta = (raw >= 0 ? "+" : "-") + formatValue(Math.abs(raw));

  let semantics: StatSemantics = "neutral";
  if (panel.higherIsBetter !== undefined && (trend === "up" || trend === "down")) {
    const good = (trend === "up") === panel.higherIsBetter;
    semantics = good ? "good" : "bad";
  }

  return {
    formattedValue,
    trend,
    formattedDelta,
    semantics,
    series: panel.series.length >= 2 ? panel.series : [],
  };
}
