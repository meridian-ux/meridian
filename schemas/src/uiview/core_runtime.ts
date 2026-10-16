// Immutable, stateless formatting/validation backed by the pinned Rust module.
// Generated code initializes synchronously from embedded bytes in browsers and
// SSR. No host configuration, clock, route resolver, fetch, or filesystem.
import * as bindings from "./generated/meridian_uiview.js";

export const coreValidation = Object.freeze({
  matchesFormPattern: bindings.matchesFormPattern,
});

export const coreFormatting = Object.freeze({
  formatValueDisplay: bindings.formatValueDisplay,
  formatValueDisplayAt: bindings.formatValueDisplayAt,
  formatInferredValue: bindings.formatInferredValue,
  formatTimestamp: bindings.formatTimestamp,
  formatRelativeTime: bindings.formatRelativeTime,
  formatStatNumber: bindings.formatStatNumber,
  formatLegacyNumber: bindings.formatLegacyNumber,
});
