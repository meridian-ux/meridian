// Compatibility barrel: the declared-value formatter lives at the framework
// seam so every browser renderer consumes the same semantics.
export {
  EMPTY_DISPLAY,
  displayValueList,
  formatByDisplay,
  formatDisplayValue,
  formatPrincipalValue,
  formatRelativeTime,
  formatTimestamp,
  isSafeHttpUrl,
  resolvePrincipalLink,
  resolveValueLink,
} from "@meridian-ux/schemas/uiview";
export type { DisplayedValue } from "@meridian-ux/schemas/uiview";
