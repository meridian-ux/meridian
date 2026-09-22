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
 * Admit an authored browser asset source.
 *
 * Panel media and walkthrough frames are passive resources, not navigation
 * destinations. Keep their contract narrower than `safeNavigationHref`: only
 * host-relative paths and HTTP(S) sources may reach a browser media element.
 * Host asset resolvers run after this check and remain responsible for any
 * trusted, surface-local translation (for example, a mounted asset prefix).
 */
export function safeAssetSrc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const src = value.trim();
  if (!src || /[\u0000-\u001f\u007f]/.test(src)) return undefined;
  try {
    const protocol = new URL(src, "https://meridian.invalid/").protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" ? src : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Admit a font source before a renderer materializes an `@font-face` rule.
 *
 * Theme font sources share the passive HTTP(S)/relative asset contract, but the
 * schema also permits self-contained data URIs. Keep that exception narrow:
 * only base64-encoded, explicitly font-typed payloads may enter stylesheet
 * `url(...)`; arbitrary data documents and active/local schemes remain inert.
 */
export function safeFontSrc(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const src = value.trim();
  if (!src || /[\u0000-\u001f\u007f]/.test(src)) return undefined;
  if (/^data:/i.test(src)) {
    return /^data:font\/(?:woff2?|ttf|otf|sfnt|collection);base64,[a-z0-9+/]+={0,2}$/i.test(src)
      ? src
      : undefined;
  }
  // Unlike an HTML src attribute, this value enters quoted CSS `url(...)`.
  // Require delimiters and whitespace to be percent-encoded by the producer.
  if (/[\s"'()\\;{}]/.test(src)) return undefined;
  return safeAssetSrc(src);
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
