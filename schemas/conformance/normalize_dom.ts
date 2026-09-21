// Stable semantic DOM for conformance goldens. This is not a browser-computed
// accessibility tree: it preserves authored roles, content, controls, and media
// while discarding kit styling, generated IDs, and layout-only wrappers.

const SEMANTIC_TAGS = new Set([
  "a", "article", "audio", "blockquote", "button", "caption", "code", "dd",
  "details", "dl", "dt", "fieldset", "figcaption", "figure", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "img", "input", "label", "legend",
  "li", "ol", "optgroup", "option", "p", "pre", "progress", "select",
  "summary", "svg", "table", "tbody", "td", "textarea", "th", "thead",
  "time", "tr", "track", "ul", "video",
]);
const ATTRIBUTES = [
  "role", "aria-label", "aria-checked", "aria-current", "aria-disabled",
  "aria-expanded", "aria-level", "aria-live", "aria-pressed", "aria-selected",
  "alt", "title", "type", "href", "src", "poster", "kind", "srclang",
  "placeholder", "value", "min", "max", "step", "datetime",
];
const FLAGS = ["disabled", "checked", "selected", "multiple", "required", "readonly", "controls", "open"];

export function normalizeDom(root: Node): string {
  const lines: string[] = [];
  function visit(node: Node, depth: number, preformatted: boolean): void {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? "";
      const text = preformatted ? raw : raw.replace(/\s+/g, " ").trim();
      if (text) lines.push(`${"  ".repeat(depth)}${JSON.stringify(text)}`);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 11) {
      node.childNodes.forEach((child) => visit(child, depth, preformatted));
      return;
    }
    const element = node as Element;
    const tag = element.localName;
    if (["style", "script", "template"].includes(tag) || element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return;
    const attributes = ATTRIBUTES.flatMap((name) => {
      const value = element.getAttribute(name);
      return value === null ? [] : [`${name}=${JSON.stringify(value)}`];
    });
    // React/MUI generate different IDs between runs. Preserve the referenced
    // words, not those unstable IDs, so a broken accessible name still fails.
    for (const name of ["aria-labelledby", "aria-describedby"]) {
      const ids = element.getAttribute(name);
      if (ids) {
        const value = ids.split(/\s+/).map((id) =>
          element.ownerDocument.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() ?? "<missing>",
        ).join(" ");
        attributes.push(`${name}=${JSON.stringify(value)}`);
      }
    }
    for (const name of FLAGS) if (element.hasAttribute(name)) attributes.push(name);
    const semantic = SEMANTIC_TAGS.has(tag) || attributes.length > 0;
    if (semantic) lines.push(`${"  ".repeat(depth)}${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}`);
    // SVG paths are visual implementation detail; the SVG's role/name survives.
    if (tag === "svg") return;
    element.childNodes.forEach((child) => visit(child, depth + Number(semantic), preformatted || tag === "pre"));
  }
  visit(root, 0, false);
  return lines.join("\n");
}

export function normalizeMarkup(markup: string): string {
  // A detached document isolates IDs and avoids leaking fixture nodes into the
  // live test DOM. It also keeps styles/scripts inert.
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = markup;
  return normalizeDom(doc.body);
}
