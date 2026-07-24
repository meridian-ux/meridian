import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// <Conversation> — the React conversation renderer. Connects the SSE stream into
// a ConversationModel and renders the transcript (BlockView) + a transient status
// + a composer that POSTs turns. The React peer of <m-assistant-panel>; both share
// the wire, the model semantics, and the CSS class names (CONVERSATION_CSS).
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationModel } from "./model.js";
import { BlockView } from "./render_react.js";
import { isActiveStatus } from "./wire.js";
export function Conversation({ sseUrl = "/api/noc-agent/view", turnUrl = "/api/noc-agent/turn", className, emptyState, placeholder = "Send a message…", }) {
    const modelRef = useRef(null);
    const model = (modelRef.current ??= new ConversationModel());
    const [, setVersion] = useState(0);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const logRef = useRef(null);
    useEffect(() => {
        const es = new EventSource(sseUrl);
        es.onmessage = (msg) => {
            try {
                const ev = JSON.parse(msg.data);
                if (model.ingest(ev)) {
                    setVersion((v) => v + 1);
                    if (ev.done || ev.error)
                        setSending(false);
                }
            }
            catch (e) {
                console.error("Conversation: bad SSE frame", e);
            }
        };
        es.onerror = () => {
            /* EventSource auto-retries */
        };
        return () => es.close();
    }, [sseUrl, model]);
    // Autoscroll to the newest block on every update.
    useEffect(() => {
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
    const send = useCallback(async (text) => {
        const q = text.trim();
        if (!q)
            return;
        setSending(true);
        setDraft("");
        try {
            const resp = await fetch(turnUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: q }),
            });
            if (!resp.ok) {
                console.error("Conversation: turn failed", resp.status);
                setSending(false);
            }
        }
        catch (e) {
            console.error("Conversation: turn error", e);
            setSending(false);
        }
    }, [turnUrl]);
    const blocks = model.blocks;
    const status = model.status_;
    const statusOn = status != null && isActiveStatus(status.state);
    return (_jsxs("div", { className: "meridian-conversation" + (className ? " " + className : ""), children: [_jsxs("div", { className: "asst-log", ref: logRef, children: [blocks.length === 0 ? (_jsx("div", { className: "ctx asst-empty", children: emptyState ?? "Ask about your repos, issues, or PRs — I'll use the connected tools." })) : (blocks.map((b, i) => (_jsx("div", { className: "asst-row " + (b.role === "user" ? "user" : "assistant"), children: _jsx(BlockView, { block: b }) }, b.blockId || i)))), _jsx("div", { className: "status" + (statusOn ? " on" : ""), children: status?.state === "THINKING" ? (_jsxs(_Fragment, { children: ["Thinking", _jsxs("span", { className: "dots", children: [_jsx("span", { children: "." }), _jsx("span", { children: "." }), _jsx("span", { children: "." })] })] })) : status?.state === "WORKING" ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "spin" }), status.detail || "Working…"] })) : null })] }), _jsxs("form", { className: "asst-input", onSubmit: (e) => {
                    e.preventDefault();
                    void send(draft);
                }, children: [_jsx("input", { className: "asst-text", type: "text", placeholder: placeholder, autoComplete: "off", value: draft, disabled: sending, onChange: (e) => setDraft(e.target.value) }), _jsx("button", { className: "asst-send", type: "submit", disabled: sending, children: "Send" })] })] }));
}
