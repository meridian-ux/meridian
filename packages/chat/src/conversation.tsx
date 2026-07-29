// <Conversation> — the React conversation renderer. Connects the SSE stream into
// a ConversationModel and renders the transcript (BlockView) + a transient status
// + a composer that POSTs turns. The React peer of <m-assistant-panel>; both share
// the wire, the model semantics, and the CSS class names (CONVERSATION_CSS).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ConversationModel } from "./model.js";
import { BlockView, type ViewRenderer } from "./render_react.js";
import { isActiveStatus, type ConversationEvent } from "./wire.js";

export interface ConversationProps {
  /** SSE endpoint of ConversationEvent frames. Default `/api/noc-agent/view`. */
  sseUrl?: string;
  /** POST endpoint for a turn ({ message }). Default `/api/noc-agent/turn`. */
  turnUrl?: string;
  /** Extra class on the wrapper. */
  className?: string;
  /** Shown before the first block arrives. */
  emptyState?: ReactNode;
  /**
   * Composer placeholder. Defaults to a product-neutral string.
   *
   * This used to be hardcoded to one product's wording, which shipped that
   * product's branding verbatim into every host that embedded the component —
   * a host could only correct it by reaching into the DOM after mount and
   * reassigning `input.placeholder`, which is what aion/web actually did.
   */
  placeholder?: string;
  /**
   * Draw a `view` block — composed UI an agent emitted as a ViewDescriptor.
   *
   * Optional, and omitting it is safe: a view block then renders as nothing,
   * exactly as any unrecognized block kind already does. A host that wants these
   * wires a meridian panel renderer up here (see the README) — this package will
   * not pull one in, because a chat transcript should not drag a component
   * library into a host that only wants text.
   */
  renderView?: ViewRenderer;
  /**
   * Send this message once, on mount, as if the user had typed it.
   *
   * Lets a host deep-link a conversation (`?q=…`) so a demo or a bug report is a
   * URL rather than a sentence to retype — and so a headless browser can drive a
   * whole turn. Sent once per mount; changing it later does not re-send, because
   * a prop change should not silently spend a turn.
   */
  initialMessage?: string;
}

export function Conversation({
  sseUrl = "/api/noc-agent/view",
  turnUrl = "/api/noc-agent/turn",
  className,
  emptyState,
  placeholder = "Send a message…",
  renderView,
  initialMessage,
}: ConversationProps): ReactNode {
  const modelRef = useRef<ConversationModel | null>(null);
  const model = (modelRef.current ??= new ConversationModel());
  const [, setVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const es = new EventSource(sseUrl);
    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as ConversationEvent;
        if (model.ingest(ev)) {
          setVersion((v) => v + 1);
          if (ev.done || ev.error) setSending(false);
        }
      } catch (e) {
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

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q) return;
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
      } catch (e) {
        console.error("Conversation: turn error", e);
        setSending(false);
      }
    },
    [turnUrl],
  );

  // Fire `initialMessage` once. The ref (not a dep on the value) is what keeps a
  // re-render or a StrictMode double-mount from spending a second turn.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (sentInitial.current || !initialMessage) return;
    sentInitial.current = true;
    void send(initialMessage);
  }, [initialMessage, send]);

  const blocks = model.blocks;
  const status = model.status_;
  const statusOn = status != null && isActiveStatus(status.state);

  return (
    <div className={"meridian-conversation" + (className ? " " + className : "")}>
      <div className="asst-log" ref={logRef}>
        {blocks.length === 0 ? (
          <div className="ctx asst-empty">
            {emptyState ?? "Ask about your repos, issues, or PRs — I'll use the connected tools."}
          </div>
        ) : (
          blocks.map((b, i) => (
            <div className={"asst-row " + (b.role === "user" ? "user" : "assistant")} key={b.blockId || i}>
              <BlockView block={b} renderView={renderView} />
            </div>
          ))
        )}
        <div className={"status" + (statusOn ? " on" : "")}>
          {status?.state === "THINKING" ? (
            <>
              Thinking
              <span className="dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </>
          ) : status?.state === "WORKING" ? (
            <>
              <span className="spin" />
              {status.detail || "Working…"}
            </>
          ) : null}
        </div>
      </div>
      <form
        className="asst-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <input
          className="asst-text"
          type="text"
          placeholder={placeholder}
          autoComplete="off"
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="asst-send" type="submit" disabled={sending}>
          Send
        </button>
      </form>
    </div>
  );
}
