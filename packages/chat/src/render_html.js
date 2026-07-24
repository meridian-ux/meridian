// renderBlockInner — a Block → an HTML string. The vanilla <m-assistant-panel>
// renderer. Lifted from meridian-web's assistant_panel.ts, now over the shared
// wire types. Pure (string in, string out) so it is directly testable.
import { escHtml as esc, mdInline } from "./dom.js";
export function renderBlockInner(b) {
    if (b.markdown)
        return `<div class="md">${mdInline(b.markdown.text || "")}</div>`;
    if (b.context) {
        return `<div class="ctx">${b.context.icon ? esc(b.context.icon) + " " : ""}${esc(b.context.text)}</div>`;
    }
    if (b.tool) {
        const t = b.tool;
        const err = t.state === "ERROR";
        const ind = t.state === "RUNNING"
            ? '<span class="spin"></span>'
            : `<span class="dot ${err ? "err" : "ok"}"></span>`;
        const args = t.argsJson && t.argsJson !== "{}" ? ` <span class="targs">${esc(t.argsJson)}</span>` : "";
        const summary = t.summary ? ` — ${esc(t.summary)}` : "";
        return `<div class="tool${err ? " err" : ""}">${ind}<span class="tname">${esc(t.name)}</span>${args}${summary}</div>`;
    }
    if (b.list) {
        const items = (b.list.items || [])
            .map((it) => {
            const badges = (it.badges || []).map((x) => `<span class="badge">${esc(x)}</span>`).join("");
            const sub = it.subtitle ? ` <span class="lsub">${esc(it.subtitle)}</span>` : "";
            return `<div class="litem"><span class="ltitle">${esc(it.title || "")}</span>${sub}<span class="lbadges">${badges}</span></div>`;
        })
            .join("");
        const head = b.list.title ? `<div class="lhead">${esc(b.list.title)}</div>` : "";
        return `<div class="list">${head}${items}</div>`;
    }
    if (b.fields) {
        const rows = (b.fields.fields || [])
            .map((f) => `<div class="k">${esc(f.key)}</div><div>${esc(f.value)}</div>`)
            .join("");
        return `<div class="fields">${rows}</div>`;
    }
    if (b.code)
        return `<pre class="code">${esc(b.code.text || "")}</pre>`;
    if (b.table) {
        const cols = b.table.columns || [];
        const head = cols.map((c) => `<th>${esc(c.label || c.key)}</th>`).join("");
        const body = (b.table.rows || [])
            .map((r) => `<tr>${cols.map((c) => `<td>${esc((r.cells || {})[c.key || ""] || "")}</td>`).join("")}</tr>`)
            .join("");
        return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    if (b.divider)
        return '<hr class="div">';
    return "";
}
