// Minimal inline markdown for authored (trusted) prose: **bold**, *emphasis*,
// `code`, and paragraph/line breaks. Content is authored by us, not user input.
export function inlineMd(s = "") {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t) =>
    t
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  return esc
    .split(/\n\n+/)
    .map((p) => `<p>${inline(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}
