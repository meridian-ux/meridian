// Shared read-view value formatting for every web renderer.
//
// A descriptor's ValueDisplay is a semantic declaration, not a kit-specific
// styling hint. Keeping the formatter at the renderer seam lets web-components,
// React kits, and future browser renderers agree without importing one another.

import {
  PrincipalDisplay,
  TemporalDisplay,
  TemporalPrecision,
  ValueType,
} from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { ValueDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";

/** Strict ISO-8601 date/time values that are safe to humanize. */
const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

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

/** Format a strict timestamp in a stable UTC representation. */
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

/** The stable empty-value representation used by read surfaces. */
export const EMPTY_DISPLAY = "—";

/** Infer a readable value for descriptors without a declared ValueDisplay. */
export function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_DISPLAY;
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_DISPLAY;
    return value.map((item) => formatDisplayValue(item)).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  if (text === "") return EMPTY_DISPLAY;
  return formatTimestamp(text) ?? text;
}

/** The individual values behind a field, for chip-like surfaces. */
export function displayValueList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => formatDisplayValue(item))
    .filter((item) => item !== EMPTY_DISPLAY && item !== "");
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** Format a timestamp relative to an explicit instant, when supplied. */
export function formatRelativeTime(text: string, nowMs: number): string | undefined {
  if (formatTimestamp(text) === undefined) return undefined;
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
  const deltaMs = parsed.getTime() - nowMs;
  const abs = Math.abs(deltaMs);

  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return RELATIVE.format(Math.round(deltaMs / MINUTE), "minute");
  if (abs < DAY) return RELATIVE.format(Math.round(deltaMs / HOUR), "hour");
  if (abs < 30 * DAY) return RELATIVE.format(Math.round(deltaMs / DAY), "day");
  if (abs < 365 * DAY) return RELATIVE.format(Math.round(deltaMs / (30 * DAY)), "month");
  return RELATIVE.format(Math.round(deltaMs / (365 * DAY)), "year");
}

function formatTemporal(text: string, precision: TemporalPrecision): string | undefined {
  if (precision === TemporalPrecision.DAY) {
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return iso ? formatTimestamp(iso[1] as string) : formatTimestamp(text);
  }
  return formatTimestamp(text);
}

function formatTime(text: string, precision: TemporalPrecision): string | undefined {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? undefined : Number(match[3]);
  if (hour > 23 || minute > 59 || (second !== undefined && second > 59)) return undefined;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  const seconds = precision === TemporalPrecision.SECOND && second !== undefined
    ? `:${String(second).padStart(2, "0")}`
    : "";
  return `${displayHour}:${String(minute).padStart(2, "0")}${seconds} ${suffix} UTC`;
}

/** A formatted value and its optional absolute title for relative displays. */
export interface DisplayedValue {
  text: string;
  title?: string;
}

/**
 * Split the wire label used for a principal when its producer has both pieces
 * of identity available. Plain names and plain email addresses remain valid
 * inputs; the angle-bracket form is the only structure this formatter infers.
 */
function principalParts(value: unknown): { name: string; email?: string } {
  const text = String(value);
  const match = /^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(text);
  if (match) return { name: match[1]!.trim(), email: match[2] };
  return { name: text, email: /^[^<>\s]+@[^<>\s]+$/.test(text) ? text : undefined };
}

/** Format a principal according to its declared name/email preference. */
export function formatPrincipalValue(
  value: unknown,
  display: PrincipalDisplay = PrincipalDisplay.UNSPECIFIED,
): DisplayedValue {
  const parts = principalParts(value);
  const name = parts.name || parts.email || EMPTY_DISPLAY;
  if (display === PrincipalDisplay.EMAIL) return { text: parts.email ?? name };
  if (display === PrincipalDisplay.NAME_WITH_EMAIL_TITLE && parts.email && parts.email !== name) {
    return { text: name, title: parts.email };
  }
  return { text: name };
}

/** Return a navigable URL only for explicitly declared, safe HTTP(S) values. */
export function isSafeHttpUrl(value: unknown, display: ValueDisplay | undefined): value is string {
  if (display?.type !== ValueType.URL || typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Format a value according to its declared ValueDisplay, with inference fallback. */
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
        (type === ValueType.TIME
          ? formatTime(text, precision)
          : formatTemporal(text, type === ValueType.DATE ? TemporalPrecision.DAY : precision)) ??
        formatDisplayValue(value);
      const wants = options?.display ?? TemporalDisplay.UNSPECIFIED;
      const relative = nowMs === undefined ? undefined : formatRelativeTime(text, nowMs);
      if (relative === undefined) return { text: absolute };
      if (wants === TemporalDisplay.RELATIVE) return { text: relative };
      if (wants === TemporalDisplay.RELATIVE_WITH_ABSOLUTE_TITLE) {
        return { text: relative, title: absolute };
      }
      return { text: absolute };
    }
    case ValueType.INTEGER:
    case ValueType.DECIMAL:
    case ValueType.MONEY:
    case ValueType.PERCENT: {
      const options = display?.options.case === "number" ? display.options.value : undefined;
      if (typeof value === "number" && options?.fractionDigits !== undefined) {
        return { text: value.toFixed(Math.max(0, options.fractionDigits)) };
      }
      return { text: formatDisplayValue(value) };
    }
    case ValueType.PRINCIPAL: {
      const options = display?.options.case === "principal" ? display.options.value : undefined;
      return formatPrincipalValue(value, options?.display ?? PrincipalDisplay.UNSPECIFIED);
    }
    case ValueType.EMAIL:
    case ValueType.URL:
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
