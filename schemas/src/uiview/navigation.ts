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

/**
 * Admit a TerminalPanel broker URL at the browser transport boundary.
 *
 * Terminal descriptors carry a WebSocket endpoint, not a general navigation
 * destination. Keep that contract narrower than `safeNavigationHref`: the URL
 * must be absolute ws/wss, must not embed credentials, and must not carry a
 * fragment that the WebSocket constructor would reject.
 */
export function safeWebSocketUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return undefined;
    if (parsed.username || parsed.password || parsed.hash) return undefined;
    return url;
  } catch {
    return undefined;
  }
}
