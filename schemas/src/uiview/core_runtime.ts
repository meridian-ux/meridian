// Immutable, stateless formatting/validation backed by the pinned Rust module.
// Generated code initializes synchronously from embedded bytes in browsers and
// SSR. No host configuration, clock, route resolver, fetch, or filesystem.
import * as bindings from "./generated/meridian_uiview.js";

/** Bounded native/WASM metadata formatter shared by operation realizations. */
// Explicit public signatures keep private wasm-bindgen classes (and optional
// resource-management symbols) out of the shipped ES2022 declaration graph.
export const formatLroMetadata: (metadata: unknown) => string = bindings.formatLroMetadata;
export const staticViewText: (bytes: Uint8Array) => string = bindings.staticViewText;

export const coreValidation: Readonly<{
  matchesFormPattern(pattern: string, value: string): boolean;
  matchesRowFilter(filter: Uint8Array, row: unknown): boolean;
}> = Object.freeze({
  matchesFormPattern: bindings.matchesFormPattern,
  matchesRowFilter: bindings.matchesRowFilter,
});

export const coreFormatting: Readonly<{
  formatValueDisplay(display: Uint8Array, value: unknown): Uint8Array;
  formatValueDisplayAt(display: Uint8Array, value: unknown, nowMs: number): Uint8Array;
  formatInferredValue(value: unknown): string;
  formatTimestamp(text: string): string | undefined;
  formatRelativeTime(text: string, nowMs: number): string | undefined;
  formatStatNumber(value: number, format: number): string;
  formatLegacyNumber(value: number, format: number): string;
}> = Object.freeze({
  formatValueDisplay: bindings.formatValueDisplay,
  formatValueDisplayAt: bindings.formatValueDisplayAt,
  formatInferredValue: bindings.formatInferredValue,
  formatTimestamp: bindings.formatTimestamp,
  formatRelativeTime: bindings.formatRelativeTime,
  formatStatNumber: bindings.formatStatNumber,
  formatLegacyNumber: bindings.formatLegacyNumber,
});
