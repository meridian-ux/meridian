// Shared read-view value formatting for the kit.
//
// Read surfaces (record cards today; table cells and detail headers can adopt
// the same helpers) render whatever the record carries. Raw is rarely what a
// human wants: a graph timestamp arrives as `2026-03-29T00:00:00.000Z`, which is
// correct and unreadable. These helpers are the one place that decides how a
// value READS, so every surface agrees.

/**
 * Strict ISO-8601: `YYYY-MM-DD`, optionally `THH:MM(:SS(.mmm))` and a zone.
 * Deliberately strict — a loose match would reformat any string that merely
 * starts with digits, and silently rewriting a user's text is worse than
 * leaving a timestamp raw.
 */
const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * ALWAYS formats in UTC.
 *
 * This runs on both sides of an SSR hydration boundary (a Next.js host renders the
 * view server-side, then hydrates it in the browser). Formatting in local time
 * would render one string on a UTC pod and a different one in a browser on
 * another zone — a hydration mismatch that React reports as a swap of the whole
 * subtree. UTC is the only zone both sides agree on without shipping the
 * viewer's zone into the render.
 */
const DATE_ONLY = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/**
 * `2026-03-29T00:00:00.000Z` → `Mar 29, 2026`
 * `2026-03-21T09:14:00.000Z` → `Mar 21, 2026, 9:14 AM UTC`
 * `2026-03-29`               → `Mar 29, 2026`
 *
 * Midnight UTC is treated as a DATE, not a moment: the graph stores plain dates
 * (a due date, a plan-year start) as midnight-Z, and printing "12:00 AM" on
 * every one of them is noise that reads like a real time-of-day.
 *
 * Returns undefined when the text is not a timestamp, so callers fall through to
 * their own handling rather than getting "Invalid Date".
 */
export function formatTimestamp(text: string): string | undefined {
  const match = ISO_8601.exec(text);
  if (!match) return undefined;
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(parsed.getTime())) return undefined;

  const hasTime = match[4] !== undefined;
  const isMidnightUtc =
    parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0 && parsed.getUTCSeconds() === 0;

  if (!hasTime || isMidnightUtc) return DATE_ONLY.format(parsed);
  return `${DATE_TIME.format(parsed)} UTC`;
}

/** The em dash every read surface uses for "no value". */
export const EMPTY_DISPLAY = "—";

/**
 * A resolved field value as display text. Arrays join, objects stringify,
 * booleans read Yes/No, timestamps humanize, empty reads as an em dash.
 */
export function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_DISPLAY;
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_DISPLAY;
    return value.map((v) => formatDisplayValue(v)).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (text === "") return EMPTY_DISPLAY;
  return formatTimestamp(text) ?? text;
}

/** The individual values behind a field, for surfaces that render one chip each. */
export function displayValueList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((v) => formatDisplayValue(v))
    .filter((v) => v !== EMPTY_DISPLAY && v !== "");
}

// ── ValueDisplay: formatting from a DECLARATION rather than a guess ──────────
//
// Everything above this line infers a value's kind from the value itself — the
// strict ISO sniff being the clearest case. That was the only option while the
// descriptor said nothing: `FormField` carried an INPUT kind and a table column
// carried `ColumnFormat`, two vocabularies for one question, and neither could
// distinguish a due date from a posting time or a person's id from any string.
//
// `ValueDisplay` (meridian-schemas 0.22.0) is the producer SAYING it. The
// inference stays as the fallback for every descriptor emitted before it, so
// nothing that renders today changes until a producer opts in.

import { TemporalDisplay, TemporalPrecision, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { ValueDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/**
 * `2026-07-25T09:18:00Z` at 2026-07-30 → "5 days ago"; a future instant → "in 3
 * months". `nowMs` is a PARAMETER, never `Date.now()` read internally, and that is
 * the whole point: relative text is a function of NOW, so a server and a client
 * that each call the clock render different strings and React reports a hydration
 * mismatch across the subtree. The caller supplies one instant — or withholds it,
 * and gets the absolute form (see `formatByDisplay`).
 *
 * Returns undefined when the text is not a timestamp, matching formatTimestamp.
 */
export function formatRelativeTime(text: string, nowMs: number): string | undefined {
  const absolute = formatTimestamp(text);
  if (absolute === undefined) return undefined;
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
  const deltaMs = parsed.getTime() - nowMs;
  const abs = Math.abs(deltaMs);

  // Grain chosen by MAGNITUDE, so "3 days ago" never reads as "72 hours ago". The
  // month/year steps use the conventional 30/365-day approximations: this is a
  // human-scale label, not an interval calculation.
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return RELATIVE.format(Math.round(deltaMs / MINUTE), "minute");
  if (abs < DAY) return RELATIVE.format(Math.round(deltaMs / HOUR), "hour");
  if (abs < 30 * DAY) return RELATIVE.format(Math.round(deltaMs / DAY), "day");
  if (abs < 365 * DAY) return RELATIVE.format(Math.round(deltaMs / (30 * DAY)), "month");
  return RELATIVE.format(Math.round(deltaMs / (365 * DAY)), "year");
}

/** The absolute form, honouring a declared precision. */
function formatTemporal(text: string, precision: TemporalPrecision): string | undefined {
  if (precision === TemporalPrecision.DAY) {
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return iso ? formatTimestamp(iso[1] as string) : formatTimestamp(text);
  }
  return formatTimestamp(text);
}

/** A resolved value plus the absolute string a relative label hangs its title on. */
export interface DisplayedValue {
  /** What to render. */
  text: string;
  /** The absolute form, when `text` is relative and the surface can show both. */
  title?: string;
}

/**
 * Format a value according to its declared `ValueDisplay`.
 *
 * `nowMs` is OPTIONAL and its absence is meaningful: without it, a temporal field
 * that asked to read relatively falls back to ABSOLUTE. That is what makes a
 * server render and a first client paint agree — the caller passes an instant only
 * once it is on the client (see useDisplayNow). A renderer that never passes one
 * still gets correct, stable output; it just never says "5 days ago".
 *
 * An unset or UNSPECIFIED type defers entirely to `formatDisplayValue`, so a
 * descriptor with no ValueDisplay renders exactly as it does today.
 */
export function formatByDisplay(
  value: unknown,
  display: ValueDisplay | undefined,
  nowMs?: number,
): DisplayedValue {
  const type = display?.type ?? ValueType.UNSPECIFIED;
  if (type === ValueType.UNSPECIFIED) return { text: formatDisplayValue(value) };
  if (value === null || value === undefined || value === "") return { text: EMPTY_DISPLAY };

  switch (type) {
    case ValueType.DATE:
    case ValueType.DATE_TIME:
    case ValueType.TIME: {
      const text = String(value);
      const options = display?.options.case === "temporal" ? display.options.value : undefined;
      const precision = options?.precision ?? TemporalPrecision.UNSPECIFIED;
      const absolute =
        formatTemporal(text, type === ValueType.DATE ? TemporalPrecision.DAY : precision)
        ?? formatDisplayValue(value);
      const wants = options?.display ?? TemporalDisplay.UNSPECIFIED;
      const relative = nowMs === undefined ? undefined : formatRelativeTime(text, nowMs);
      if (relative === undefined) return { text: absolute };
      if (wants === TemporalDisplay.RELATIVE) return { text: relative };
      if (wants === TemporalDisplay.RELATIVE_WITH_ABSOLUTE_TITLE) {
        return { text: relative, title: absolute };
      }
      return { text: absolute };
    }
    // A person is rendered by the producer's chosen label; the renderer's job is
    // only to not print a raw id where a name belongs, which the projection now
    // prevents upstream by resolving the reference. Nothing to reformat here yet —
    // the value ALREADY is the label. Kept explicit so the case is not silently
    // swept into the default and later mistaken for unhandled.
    case ValueType.PRINCIPAL:
    case ValueType.EMAIL:
    case ValueType.URL:
      return { text: String(value) };
    case ValueType.IDENTIFIER:
      return { text: String(value) };
    case ValueType.BOOLEAN:
      return { text: value ? "Yes" : "No" };
    case ValueType.LIST:
      return { text: displayValueList(value).join(", ") || EMPTY_DISPLAY };
    default:
      return { text: formatDisplayValue(value) };
  }
}
