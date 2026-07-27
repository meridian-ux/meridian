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
 * This runs on both sides of an SSR hydration boundary (aion/web renders the
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
