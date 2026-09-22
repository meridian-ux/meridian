/**
 * Admit an authored navigation URI at the browser boundary.
 *
 * Affordances intentionally support application deep links such as `cursor://`
 * and `vscode:` in addition to HTTP(S) and relative routes. Those protocols are
 * retained, while executable/document-local schemes and control characters are
 * rejected. Renderers must degrade a rejected URI to a noninteractive control.
 */
export function safeNavigationHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const href = value.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return undefined;
  try {
    const protocol = new URL(href, "https://meridian.invalid/").protocol.toLowerCase();
    return ["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(protocol)
      ? undefined
      : href;
  } catch {
    return undefined;
  }
}
