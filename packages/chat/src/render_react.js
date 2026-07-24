import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// BlockView — a Block → React nodes. The React peer of render_html's
// renderBlockInner, same class names so it shares the CONVERSATION_CSS.
import { Fragment } from "react";
import { mdInline } from "./dom.js";
export function BlockView({ block }) {
    if (block.markdown) {
        // mdInline escapes the text first, then adds a small safe tag set.
        return _jsx("div", { className: "md", dangerouslySetInnerHTML: { __html: mdInline(block.markdown.text || "") } });
    }
    if (block.context) {
        return (_jsxs("div", { className: "ctx", children: [block.context.icon ? block.context.icon + " " : "", block.context.text] }));
    }
    if (block.tool) {
        const t = block.tool;
        const err = t.state === "ERROR";
        return (_jsxs("div", { className: "tool" + (err ? " err" : ""), children: [t.state === "RUNNING" ? _jsx("span", { className: "spin" }) : _jsx("span", { className: "dot " + (err ? "err" : "ok") }), _jsx("span", { className: "tname", children: t.name }), t.argsJson && t.argsJson !== "{}" ? _jsxs("span", { className: "targs", children: [" ", t.argsJson] }) : null, t.summary ? _jsxs(_Fragment, { children: [" \u2014 ", t.summary] }) : null] }));
    }
    if (block.list) {
        return (_jsxs("div", { className: "list", children: [block.list.title ? _jsx("div", { className: "lhead", children: block.list.title }) : null, (block.list.items || []).map((it, i) => (_jsxs("div", { className: "litem", children: [_jsx("span", { className: "ltitle", children: it.title }), it.subtitle ? _jsxs("span", { className: "lsub", children: [" ", it.subtitle] }) : null, _jsx("span", { className: "lbadges", children: (it.badges || []).map((b, j) => (_jsx("span", { className: "badge", children: b }, j))) })] }, i)))] }));
    }
    if (block.fields) {
        return (_jsx("div", { className: "fields", children: (block.fields.fields || []).map((f, i) => (_jsxs(Fragment, { children: [_jsx("div", { className: "k", children: f.key }), _jsx("div", { children: f.value })] }, i))) }));
    }
    if (block.code)
        return _jsx("pre", { className: "code", children: block.code.text });
    if (block.table) {
        const cols = block.table.columns || [];
        return (_jsxs("table", { className: "tbl", children: [_jsx("thead", { children: _jsx("tr", { children: cols.map((c, i) => (_jsx("th", { children: c.label || c.key }, i))) }) }), _jsx("tbody", { children: (block.table.rows || []).map((r, i) => (_jsx("tr", { children: cols.map((c, j) => (_jsx("td", { children: (r.cells || {})[c.key || ""] || "" }, j))) }, i))) })] }));
    }
    if (block.divider)
        return _jsx("hr", { className: "div" });
    return null;
}
