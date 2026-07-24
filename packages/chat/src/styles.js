// The conversation renderer's CSS. Authored once against the `m-assistant-panel`
// custom element; the React tier reuses it re-scoped to `.meridian-conversation`
// (same inner class names: .md / .tool / .list / .fields / .asst-input / …). Kept
// framework-free (no HTMLElement reference) so both tiers can import it, including
// under SSR.
// ── Theming contract ────────────────────────────────────────────────────────
// Four base tokens (--text, --accent, --surface, --muted) plus the DERIVED tokens
// below. Every derived value defaults to exactly the expression it replaced, so a
// host that binds nothing renders identically to before.
//
// The derived tokens exist because the derivations are DARK-ONLY and no value of
// --surface fixes that. Each raised surface is `color-mix(… --surface N%, #080910)`
// — it DARKENS to stand out — and each border mixes toward #fff. Bind --surface:#fff
// for a light theme and the assistant bubble computes to mid-grey on white while the
// borders vanish; mixing 30% of near-black caps the result around 70% lightness, so
// the bubble cannot be made light by any --surface at all. A host on a light theme
// previously had to restate ~9 rules after the imported sheet. Now it binds tokens:
//
//   --surface-raised    assistant bubble
//   --surface-head      list header
//   --border            list + fields outline
//   --border-inset      list-item / table-cell separators
//   --border-divider    horizontal rule
//   --border-composer   composer top edge
//   --field-border      composer input outline
//   --field-bg          composer input fill
//   --code-bg           inline `code` fill
export const ASSISTANT_PANEL_CSS = `
  m-assistant-panel { display: flex; flex-direction: column; height: 100%; min-height: 0;
    color: var(--text, #e5e7eb); font: 13px/1.5 system-ui, sans-serif; }
  m-assistant-panel .asst-log { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px;
    display: flex; flex-direction: column; gap: 12px; }
  m-assistant-panel .asst-row { display: flex; }
  m-assistant-panel .asst-row.user { justify-content: flex-end; }
  m-assistant-panel .asst-row > * { max-width: 82%; }

  /* markdown bubbles */
  m-assistant-panel .md { padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
  m-assistant-panel .asst-row.user .md { background: var(--accent, #6366f1); color: #fff; border-bottom-right-radius: 3px; }
  m-assistant-panel .asst-row.assistant .md { background: var(--surface-raised, color-mix(in srgb, var(--surface, #1a1d27) 70%, #080910)); border-bottom-left-radius: 3px; }
  m-assistant-panel .md code { font-family: ui-monospace, Menlo, monospace; font-size: 12px;
    background: var(--code-bg, rgba(255,255,255,0.08)); padding: 1px 4px; border-radius: 4px; }

  /* tool card */
  m-assistant-panel .tool { display: flex; align-items: center; gap: 8px; font: 12px/1.4 ui-monospace, Menlo, monospace;
    padding: 6px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 28%, transparent);
    background: color-mix(in srgb, var(--accent, #6366f1) 8%, transparent); color: var(--muted, #9ca3af); }
  m-assistant-panel .tool .tname { color: var(--text, #e5e7eb); }
  m-assistant-panel .tool .targs { opacity: 0.7; }
  m-assistant-panel .tool.err { border-color: color-mix(in srgb, #ef4444 45%, transparent); background: color-mix(in srgb, #ef4444 10%, transparent); color: #fca5a5; }
  m-assistant-panel .tool .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  m-assistant-panel .tool .dot.ok { background: #22c55e; }
  m-assistant-panel .tool .dot.err { background: #ef4444; }
  m-assistant-panel .spin { width: 10px; height: 10px; flex: none; border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--accent, #6366f1) 30%, transparent); border-top-color: var(--accent, #6366f1);
    animation: masp-spin 0.7s linear infinite; }
  @keyframes masp-spin { to { transform: rotate(360deg); } }

  /* list */
  m-assistant-panel .list { width: 100%; border: 1px solid var(--border, color-mix(in srgb, var(--surface, #1a1d27) 55%, #fff)); border-radius: 10px; overflow: hidden; }
  m-assistant-panel .list .lhead { padding: 8px 12px; font-weight: 600; font-size: 12px; letter-spacing: .02em;
    background: var(--surface-head, color-mix(in srgb, var(--surface, #1a1d27) 65%, #080910)); border-bottom: 1px solid var(--border, color-mix(in srgb, var(--surface, #1a1d27) 55%, #fff)); }
  m-assistant-panel .list .litem { display: flex; align-items: baseline; gap: 8px; padding: 6px 12px; }
  m-assistant-panel .list .litem + .litem { border-top: 1px solid var(--border-inset, color-mix(in srgb, var(--surface, #1a1d27) 45%, #000)); }
  m-assistant-panel .list .ltitle { font-weight: 500; }
  m-assistant-panel .list .lsub { color: var(--muted, #9ca3af); font-size: 12px; }
  m-assistant-panel .list .lbadges { margin-left: auto; display: flex; gap: 4px; flex-wrap: wrap; }
  m-assistant-panel .badge { font-size: 11px; padding: 1px 6px; border-radius: 10px;
    background: color-mix(in srgb, var(--accent, #6366f1) 16%, transparent); color: color-mix(in srgb, var(--text, #e5e7eb) 85%, var(--accent)); }

  /* fields / code / context / divider */
  m-assistant-panel .fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; padding: 8px 12px;
    border: 1px solid var(--border, color-mix(in srgb, var(--surface, #1a1d27) 55%, #fff)); border-radius: 10px; }
  m-assistant-panel .fields .k { color: var(--muted, #9ca3af); }
  m-assistant-panel pre.code { width: 100%; overflow: auto; padding: 10px 12px; border-radius: 10px; margin: 0;
    background: #0b0d14; font: 12px/1.5 ui-monospace, Menlo, monospace; }
  m-assistant-panel table.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
  m-assistant-panel table.tbl th, m-assistant-panel table.tbl td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--border-inset, color-mix(in srgb, var(--surface, #1a1d27) 45%, #000)); }
  m-assistant-panel table.tbl th { color: var(--muted, #9ca3af); font-weight: 600; }
  m-assistant-panel .ctx { color: var(--muted, #9ca3af); font-size: 12px; }
  m-assistant-panel hr.div { width: 100%; border: none; border-top: 1px solid var(--border-divider, color-mix(in srgb, var(--surface, #1a1d27) 45%, #fff)); }
  m-assistant-panel .err { align-self: center; color: #fca5a5; font-size: 12px; }

  /* status row */
  m-assistant-panel .status { display: none; align-items: center; gap: 8px; color: var(--muted, #9ca3af); font-size: 12px; padding: 2px; }
  m-assistant-panel .status.on { display: flex; }
  m-assistant-panel .dots span { animation: masp-blink 1.2s infinite; }
  m-assistant-panel .dots span:nth-child(2) { animation-delay: .2s; }
  m-assistant-panel .dots span:nth-child(3) { animation-delay: .4s; }
  @keyframes masp-blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }

  /* input */
  m-assistant-panel form.asst-input { display: flex; gap: 8px; padding: 12px 20px;
    border-top: 1px solid var(--border-composer, color-mix(in srgb, var(--surface, #1a1d27) 60%, #fff)); }
  m-assistant-panel input.asst-text { flex: 1; padding: 8px 12px; border-radius: 8px;
    border: 1px solid var(--field-border, color-mix(in srgb, var(--surface, #1a1d27) 50%, #fff)); background: var(--field-bg, var(--surface, #1a1d27)); color: var(--text, #e5e7eb); font: inherit; }
  m-assistant-panel button.asst-send { padding: 8px 16px; border-radius: 8px; border: none; background: var(--accent, #6366f1); color: #fff; font: inherit; cursor: pointer; }
  m-assistant-panel button.asst-send:disabled { opacity: .5; cursor: default; }
`;
/** The same styles, re-scoped for the React <Conversation> wrapper. */
export const CONVERSATION_CSS = ASSISTANT_PANEL_CSS.replace(/m-assistant-panel/g, ".meridian-conversation");
