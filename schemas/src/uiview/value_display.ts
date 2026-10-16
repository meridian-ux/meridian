// All value formatting executes in the same Rust core used by native surfaces.
// JavaScript owns protobuf adaptation, routing, and renderer decoration only.
import {
  FormattedValueSchema, PrincipalDisplay, ValueType, ValueDisplaySchema,
} from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { ValueDisplay } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { ColumnFormat } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { coreFormatting } from "./core_runtime.js";

/** Standalone initialized core capability, separate from panel rendering. */
export interface ValueFormatterWasm {
  formatValueDisplay(display: Uint8Array, value: unknown): Uint8Array;
  /** Older modules remain valid for clock-free explicit adapter calls. */
  formatValueDisplayAt?(display: Uint8Array, value: unknown, nowMs: number): Uint8Array;
}

/** Runtime projection of the canonical FormattedValue protobuf. */
export interface DisplayedValue { text: string; title?: string; }

/** Decode a core result without running a second formatter or hiding failures. */
export function formatByCore(value: unknown, display: ValueDisplay, core: ValueFormatterWasm, nowMs?: number): DisplayedValue {
  const bytes = toBinary(ValueDisplaySchema, display);
  if (nowMs !== undefined && !core.formatValueDisplayAt) throw new Error("Core binding lacks explicit-clock value formatting");
  const input = value === undefined ? null : value;
  const output = nowMs === undefined ? core.formatValueDisplay(bytes, input) : core.formatValueDisplayAt!(bytes, input, nowMs);
  const result = fromBinary(FormattedValueSchema, output);
  return { text: result.text, ...(result.title === undefined ? {} : { title: result.title }) };
}

export const EMPTY_DISPLAY = "—";

/** Legacy inference also uses the core parser; no locale or process clock. */
export function formatDisplayValue(value: unknown): string {
  return coreFormatting.formatInferredValue(value === undefined ? null : value);
}

export function formatTimestamp(text: string): string | undefined {
  return coreFormatting.formatTimestamp(text);
}

export function formatRelativeTime(text: string, nowMs: number): string | undefined {
  return coreFormatting.formatRelativeTime(text, nowMs);
}

/** Legacy columns retain the native ColumnFormat rounding contract. */
export function formatLegacyNumber(value: number, format: ColumnFormat): string {
  return coreFormatting.formatLegacyNumber(value, format);
}

/** A list-shaped surface adapter, not a second scalar-formatting algorithm. */
export function displayValueList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(formatDisplayValue)
    .filter(item => item !== EMPTY_DISPLAY && item !== "");
}

export function formatPrincipalValue(value: unknown, display: PrincipalDisplay = PrincipalDisplay.UNSPECIFIED): DisplayedValue {
  return formatByCore(value, create(ValueDisplaySchema, {
    type: ValueType.PRINCIPAL, options: { case: "principal", value: { display } },
  }), coreFormatting);
}

/** Default browser and SSR path: the packaged initialized Rust core. */
export function formatByDisplay(value: unknown, display: ValueDisplay | undefined, nowMs?: number): DisplayedValue {
  if (!display) return { text: formatDisplayValue(value) };
  return formatByCore(value, display, coreFormatting, nowMs);
}

/** Host-owned routing inputs preserve the raw scalar, never a display label. */
export function resolvePrincipalLink(value: unknown, display: ValueDisplay | undefined): { targetKind: string; id: string } | undefined {
  if (!display || (display.type !== ValueType.PRINCIPAL && display.type !== ValueType.EMAIL)
    || display.options.case !== "principal") return undefined;
  const options = display.options.value;
  if (!options.linkToRecord || !options.targetKind.trim()) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  const id = String(value);
  const targetKind = options.targetKind.trim();
  return id.trim() === "" ? undefined : { targetKind, id };
}

/** Explicit ValueLink presence still takes precedence over legacy link fields. */
export function resolveValueLink(value: unknown, display: ValueDisplay | undefined): { targetKind: string; id: string } | undefined {
  if (display?.link) {
    const targetKind = display.link.targetKind.trim();
    if (!targetKind) return undefined;
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    if (typeof value === "number" && !Number.isFinite(value)) return undefined;
    const id = String(value);
    return id.trim() === "" ? undefined : { targetKind, id };
  }
  return resolvePrincipalLink(value, display);
}

/** Navigation admission remains host/surface behavior, not Rust formatting. */
export function isSafeHttpUrl(value: unknown, display: ValueDisplay | undefined): value is string {
  if (display?.type !== ValueType.URL || typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch { return false; }
}
