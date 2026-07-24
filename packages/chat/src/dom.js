// Tiny DOM/text helpers for the vanilla web-component renderer (HTML strings).
// Lifted from meridian-web's dom.ts; the React tier does not use these (React
// escapes for you).
export function escHtml(value) {
    return (value || "")
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
export function shortName(resourceName) {
    if (!resourceName)
        return "";
    const idx = resourceName.lastIndexOf("/");
    return idx >= 0 ? resourceName.slice(idx + 1) : resourceName;
}
/** Minimal inline markdown → HTML: **bold**, `code`, newlines. Escapes first. */
export function mdInline(text) {
    return escHtml(text)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
}
