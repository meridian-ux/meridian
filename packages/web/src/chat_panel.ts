// <m-chat-panel> — a meridian primitive that renders the agora-loop
// chat plane.
//
// Two panes:
//   left  : the sequence of turns (NL query + winner + outcome)
//   right : every triple the loop has materialized so far, in
//           arrival order, with the bidder that produced it
//
// Bottom row: input box + send button.
//
// Attributes:
//   sse-url   default `/api/noc-agent/view`
//             SSE endpoint. Each `data:` frame must be a JSON-encoded
//             `botnoc.v1.KgViewEvent` (proto-derived, see
//             proto/botnoc/v1/chat.proto).
//   turn-url  default `/api/noc-agent/turn`
//             POST endpoint. Body: `{ "query": "..." }`. The
//             response is the round's KgViewEvent; the panel
//             relies on the SSE re-publishing the same event,
//             so it doesn't render from the POST response.
//
// This component is purely declarative state-from-stream: the
// SSE is the source of truth. Even if the user opens the page
// after several rounds have happened, reconnecting with
// `Last-Event-ID` (once noc-agent supports replay) will catch
// the panel up; without replay, late connections see future
// events only. That matches `Agora.Trace.same_view_audit_replayable`:
// the projection is determined by the trace.

interface ChatTriple {
  subject: string;
  predicate: string;
  object: string;
}

interface ChatBinding {
  variable: string;
  constant: string;
}

interface SubRound {
  sentence: string;
  bids: { tool: string; value: number }[];
  winner: string;
  price: number;
  outcome: { kind: string; payload: string };
  delta: ChatTriple[];
  witness?: ChatBinding[];
}

interface KgViewEvent {
  event_id: number;
  round: number;
  ts: string;
  query: string;
  bids: { tool: string; value: number }[];
  winner: string;
  price: number;
  outcome: { kind: string; payload: string };
  delta: ChatTriple[];
  kg_size: number;
  parsed_intent?: string[];
  sub_rounds?: SubRound[];
}

interface BiddingStrategy {
  kind: string;
  floor?: number;
  model_id?: string;
}

interface BidderEntry {
  id: string;
  nl_description: string;
  capability: string;
  strategy: BiddingStrategy;
  equivalence_class: string[];
}

interface BidderManifest {
  version: string;
  bidders: BidderEntry[];
}

interface BalanceEntry {
  tool_id: string;
  balance: number;
  total_won: number;
  total_paid: number;
}

interface TokenUsageEntry {
  tool_id: string;
  input_tokens: number;
  output_tokens: number;
}

export const CHAT_PANEL_CSS = `
  m-chat-panel {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100%;
    min-height: 480px;
    border: 1px solid var(--border, #2e3147);
    border-radius: 12px;
    background: var(--surface, #1a1d27);
    overflow: hidden;
    font: 13px/1.4 system-ui, sans-serif;
    color: var(--text, #e5e7eb);
  }

  m-chat-panel .chat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    min-height: 0;
  }

  @media (max-width: 720px) {
    m-chat-panel .chat-grid { grid-template-columns: 1fr; }
  }

  m-chat-panel .chat-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px;
  }

  m-chat-panel .chat-pane + .chat-pane {
    border-left: 1px solid var(--border, #2e3147);
  }

  m-chat-panel .chat-pane-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, #94a3b8);
    margin: 0 0 8px;
  }

  m-chat-panel .chat-turn {
    border: 1px solid var(--border, #2e3147);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface, #1a1d27) 70%, #080910);
    padding: 8px 10px;
    margin-bottom: 8px;
  }
  m-chat-panel .chat-turn-head {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-muted, #94a3b8);
    margin-bottom: 4px;
  }
  m-chat-panel .chat-turn-query {
    font-weight: 600;
    margin-bottom: 6px;
  }
  m-chat-panel .chat-turn-winner {
    font-size: 11px;
    color: var(--accent, #6366f1);
    margin-bottom: 4px;
  }
  m-chat-panel .chat-turn-outcome {
    font-size: 12px;
    color: var(--text-muted, #94a3b8);
    word-break: break-word;
    font-family: ui-monospace, monospace;
  }

  m-chat-panel .chat-triple {
    display: grid;
    grid-template-columns: 1fr;
    border-left: 2px solid var(--accent, #6366f1);
    padding: 6px 10px;
    margin-bottom: 6px;
    background: color-mix(in srgb, var(--surface, #1a1d27) 70%, #080910);
    font-family: ui-monospace, monospace;
    font-size: 12px;
    word-break: break-all;
  }
  m-chat-panel .chat-triple-spo {
    line-height: 1.35;
  }
  m-chat-panel .chat-triple-meta {
    font-size: 10px;
    color: var(--text-muted, #94a3b8);
    margin-top: 2px;
  }
  m-chat-panel .chat-triple-pred {
    color: var(--accent, #6366f1);
  }

  m-chat-panel .chat-input-row {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--border, #2e3147);
  }
  m-chat-panel .chat-input {
    flex: 1;
    background: color-mix(in srgb, var(--surface, #1a1d27) 70%, #080910);
    color: var(--text, #e5e7eb);
    border: 1px solid var(--border, #2e3147);
    border-radius: 6px;
    padding: 8px 10px;
    font: inherit;
  }
  m-chat-panel .chat-send {
    background: var(--accent, #6366f1);
    color: #fff;
    border: 0;
    border-radius: 6px;
    padding: 0 14px;
    font-weight: 600;
    cursor: pointer;
  }
  m-chat-panel .chat-send[disabled] { opacity: 0.5; cursor: wait; }

  m-chat-panel .chat-empty {
    color: var(--text-muted, #94a3b8);
    font-style: italic;
    padding: 12px;
  }

  m-chat-panel .chat-parsed-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 6px 0 8px;
    font-size: 11px;
  }
  m-chat-panel .chat-parsed-label {
    color: var(--text-muted, #94a3b8);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 4px;
  }
  m-chat-panel .chat-parsed-pill {
    background: color-mix(in srgb, var(--accent, #6366f1) 18%, transparent);
    color: var(--text, #e5e7eb);
    border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 35%, transparent);
    border-radius: 999px;
    padding: 2px 10px;
    font-family: ui-monospace, monospace;
  }
  m-chat-panel .chat-subround {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--border, #2e3147);
  }
  m-chat-panel .chat-subround-head {
    font-size: 11px;
    color: var(--accent, #6366f1);
    font-family: ui-monospace, monospace;
    margin-bottom: 4px;
  }
  m-chat-panel .chat-subround-winner {
    font-size: 11px;
    color: var(--text-muted, #94a3b8);
    margin-bottom: 4px;
  }
  m-chat-panel .chat-subround-outcome {
    font-size: 12px;
    color: var(--text-muted, #94a3b8);
    margin-bottom: 6px;
    font-family: ui-monospace, monospace;
    word-break: break-word;
  }

  m-chat-panel .chat-sigma {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0 8px;
    font-size: 11px;
    font-family: ui-monospace, monospace;
  }
  m-chat-panel .chat-sigma-label {
    color: var(--text-muted, #94a3b8);
    margin-right: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  m-chat-panel .chat-sigma-bind {
    background: color-mix(in srgb, var(--accent, #6366f1) 15%, transparent);
    color: var(--text, #e5e7eb);
    border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 30%, transparent);
    border-radius: 4px;
    padding: 1px 6px;
  }
  m-chat-panel .chat-sigma-bind .var {
    color: var(--accent, #6366f1);
    margin-right: 4px;
  }

  m-chat-panel .chat-tokens {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    margin-bottom: 6px;
    padding: 2px 8px;
    background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
    border-radius: 4px;
    font-size: 10px;
    font-family: ui-monospace, monospace;
    color: var(--text-muted, #94a3b8);
  }
  m-chat-panel .chat-tokens b { color: var(--text, #e5e7eb); }

  m-chat-panel .chat-auction {
    margin-top: 6px;
    border-top: 1px dashed var(--border, #2e3147);
    padding-top: 6px;
  }
  m-chat-panel .chat-auction-summary {
    cursor: pointer;
    font-size: 10px;
    color: var(--text-muted, #94a3b8);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    list-style: none;
  }
  m-chat-panel .chat-auction-summary::-webkit-details-marker { display: none; }
  m-chat-panel .chat-auction-summary::before {
    content: "▸ ";
    display: inline-block;
    width: 1em;
  }
  m-chat-panel .chat-auction[open] .chat-auction-summary::before {
    content: "▾ ";
  }
  m-chat-panel .chat-auction-table {
    margin-top: 6px;
    width: 100%;
    border-collapse: collapse;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  m-chat-panel .chat-auction-table th,
  m-chat-panel .chat-auction-table td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--border, #2e3147) 50%, transparent);
  }
  m-chat-panel .chat-auction-table th {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #94a3b8);
    font-weight: 600;
  }
  m-chat-panel .chat-auction-table .winner {
    background: color-mix(in srgb, var(--accent, #6366f1) 18%, transparent);
    font-weight: 600;
  }
  m-chat-panel .chat-auction-table .winner-mark {
    color: var(--accent, #6366f1);
    margin-right: 4px;
  }
  m-chat-panel .chat-auction-price {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-muted, #94a3b8);
  }
  m-chat-panel .chat-auction-price b {
    color: var(--text, #e5e7eb);
  }
  m-chat-panel .chat-auction-strategy {
    color: var(--text-muted, #94a3b8);
    font-size: 10px;
    margin-left: 6px;
  }

  m-chat-panel .chat-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border, #2e3147);
  }
  m-chat-panel .chat-toolbar-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #94a3b8);
    flex: 1;
  }
  m-chat-panel .chat-toolbar-btn {
    background: transparent;
    border: 1px solid var(--border, #2e3147);
    color: var(--text-muted, #94a3b8);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 11px;
    cursor: pointer;
  }
  m-chat-panel .chat-toolbar-btn:hover {
    color: var(--text, #e5e7eb);
    border-color: var(--accent, #6366f1);
  }

  /* Drawer is fixed to the viewport, not to the chat panel — so
     it never gets clipped by the panel's height, no matter how
     short the panel renders. */
  m-chat-panel .chat-drawer {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: min(440px, 92vw);
    background: var(--surface, #1a1d27);
    border-left: 1px solid var(--border, #2e3147);
    box-shadow: -8px 0 24px rgba(0,0,0,0.4);
    padding: 14px 16px;
    overflow-y: auto;
    transform: translateX(100%);
    transition: transform 0.2s ease;
    z-index: 1000;
  }
  m-chat-panel .chat-drawer.open { transform: translateX(0); }

  /* Backdrop behind the drawer — click to close, dims the rest. */
  m-chat-panel .chat-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    z-index: 999;
  }
  m-chat-panel .chat-drawer-backdrop.open {
    opacity: 1;
    pointer-events: auto;
  }
  m-chat-panel .chat-drawer-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  m-chat-panel .chat-drawer h3 {
    margin: 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #94a3b8);
  }
  m-chat-panel .chat-drawer-close {
    background: transparent;
    border: 0;
    color: var(--text-muted, #94a3b8);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
  }
  m-chat-panel .chat-bidder {
    padding: 10px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border, #2e3147) 50%, transparent);
  }
  m-chat-panel .chat-bidder-id {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--accent, #6366f1);
    word-break: break-all;
  }
  m-chat-panel .chat-bidder-strategy {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #94a3b8);
    margin-top: 4px;
  }
  m-chat-panel .chat-bidder-desc {
    font-size: 12px;
    margin-top: 4px;
    color: var(--text, #e5e7eb);
  }
  m-chat-panel .chat-bidder-cap {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    margin-top: 4px;
    color: var(--text-muted, #94a3b8);
    word-break: break-word;
  }
  m-chat-panel .chat-bidder-balance {
    display: flex;
    gap: 10px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-muted, #94a3b8);
    font-family: ui-monospace, monospace;
  }
  m-chat-panel .chat-bidder-balance .bal {
    color: var(--text, #e5e7eb);
    font-weight: 600;
  }
  m-chat-panel .chat-bidder-balance .bal-low {
    color: #fb923c;
  }
  m-chat-panel .chat-bidder-tokens {
    display: flex;
    gap: 10px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-muted, #94a3b8);
    font-family: ui-monospace, monospace;
  }
  m-chat-panel .chat-bidder-tokens .tk {
    color: var(--text, #e5e7eb);
    font-weight: 600;
  }

  m-chat-panel {
    position: relative;
  }
`;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderParsedIntent(ev: KgViewEvent): string {
  const intents = ev.parsed_intent || [];
  if (!intents.length) return '';
  const pills = intents
    .map((s) => `<span class="chat-parsed-pill">${esc(s)}</span>`)
    .join('');
  return [
    `<div class="chat-parsed-row">`,
    `<span class="chat-parsed-label">parsed as</span>`,
    pills,
    `</div>`,
  ].join('');
}

function renderSigma(σ: ChatBinding[] | undefined): string {
  if (!σ || !σ.length) return '';
  const pills = σ
    .map(
      (b) =>
        `<span class="chat-sigma-bind"><span class="var">${esc(b.variable)}</span>= ${esc(b.constant)}</span>`,
    )
    .join('');
  return [
    `<div class="chat-sigma">`,
    `<span class="chat-sigma-label">σ</span>`,
    pills,
    `</div>`,
  ].join('');
}

function tokenBadgeFromDelta(delta: ChatTriple[]): string {
  let input = 0;
  let output = 0;
  for (const t of delta || []) {
    if (t.predicate === 'chat:usedInputTokens') {
      const n = parseInt(t.object, 10);
      if (!isNaN(n)) input += n;
    } else if (t.predicate === 'chat:usedOutputTokens') {
      const n = parseInt(t.object, 10);
      if (!isNaN(n)) output += n;
    }
  }
  if (input === 0 && output === 0) return '';
  return `<div class="chat-tokens">tokens: <b>${input}</b> in / <b>${output}</b> out</div>`;
}

function renderSubRound(
  sr: SubRound,
  manifest: BidderManifest | null,
  index: number,
): string {
  const byId = new Map<string, BidderEntry>(
    (manifest?.bidders || []).map((b) => [b.id, b]),
  );
  const bids = sr.bids.slice().sort((a, b) => b.value - a.value);
  const rows = bids
    .map((b) => {
      const isWin = b.tool === sr.winner;
      const mark = isWin ? `<span class="winner-mark">✓</span>` : '';
      const entry = byId.get(b.tool) || null;
      const strat = entry
        ? `<span class="chat-auction-strategy">${esc(strategyLabel(entry.strategy))}</span>`
        : '';
      return [
        `<tr class="${isWin ? 'winner' : ''}">`,
        `<td>${mark}${esc(b.tool)}${strat}</td>`,
        `<td>${b.value.toFixed(4)}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('');
  const winnerLine = sr.winner
    ? `→ ${esc(sr.winner)} (price ${sr.price.toFixed(4)})`
    : '(no bidder)';
  const empty = `<tr><td colspan="2" class="chat-empty" style="padding:6px;">no bids</td></tr>`;
  return [
    `<div class="chat-subround">`,
    `<div class="chat-subround-head">sentence ${index + 1}: ${esc(sr.sentence)}</div>`,
    `<div class="chat-subround-winner">${winnerLine}</div>`,
    renderSigma(sr.witness),
    `<div class="chat-subround-outcome">${esc(sr.outcome?.payload ?? '')}</div>`,
    tokenBadgeFromDelta(sr.delta),
    `<table class="chat-auction-table">`,
    `<thead><tr><th>bidder</th><th>value</th></tr></thead>`,
    `<tbody>${bids.length ? rows : empty}</tbody>`,
    `</table>`,
    `</div>`,
  ].join('');
}

function renderTurn(ev: KgViewEvent, manifest: BidderManifest | null): string {
  const ts = ev.ts ? new Date(ev.ts).toLocaleTimeString() : '';
  const winner = ev.winner || '(no bid)';
  const subRounds = ev.sub_rounds || [];
  const hasFanOut = subRounds.length > 1;
  // For single-sub-round (or no decomposition), keep the original
  // compact layout. For multi-sentence fan-outs render one
  // sub-round block each — winner + outcome + auction table.
  const body = hasFanOut
    ? [
        renderParsedIntent(ev),
        ...subRounds.map((sr, i) => renderSubRound(sr, manifest, i)),
      ].join('')
    : [
        renderParsedIntent(ev),
        `<div class="chat-turn-winner">→ ${esc(winner)}</div>`,
        renderSigma(subRounds[0]?.witness),
        `<div class="chat-turn-outcome">${esc(ev.outcome?.payload ?? '')}</div>`,
        tokenBadgeFromDelta(ev.delta),
        renderAuction(ev, manifest),
      ].join('');
  return [
    `<div class="chat-turn" data-event-id="${ev.event_id}">`,
    `<div class="chat-turn-head">`,
    `<span>round ${ev.round}</span>`,
    `<span>${esc(ts)}</span>`,
    `</div>`,
    `<div class="chat-turn-query">${esc(ev.query)}</div>`,
    body,
    `</div>`,
  ].join('');
}

function renderBidder(
  b: BidderEntry,
  balance: BalanceEntry | null,
  tokens: TokenUsageEntry | null,
): string {
  let balanceRow = '';
  if (balance) {
    const lowClass = balance.balance < 50 ? 'bal bal-low' : 'bal';
    balanceRow =
      `<div class="chat-bidder-balance">` +
      `<span>balance <span class="${lowClass}">${balance.balance.toFixed(2)}</span></span>` +
      `<span>won <span class="bal">${balance.total_won}</span></span>` +
      `<span>paid <span class="bal">${balance.total_paid.toFixed(2)}</span></span>` +
      `</div>`;
  }
  let tokensRow = '';
  if (tokens && (tokens.input_tokens > 0 || tokens.output_tokens > 0)) {
    tokensRow =
      `<div class="chat-bidder-tokens">` +
      `<span>tokens in <span class="tk">${tokens.input_tokens}</span></span>` +
      `<span>tokens out <span class="tk">${tokens.output_tokens}</span></span>` +
      `</div>`;
  }
  return [
    `<div class="chat-bidder">`,
    `<div class="chat-bidder-id">${esc(b.id)}</div>`,
    `<div class="chat-bidder-strategy">${esc(strategyLabel(b.strategy))}</div>`,
    `<div class="chat-bidder-desc">${esc(b.nl_description)}</div>`,
    `<div class="chat-bidder-cap">capability: ${esc(b.capability)}</div>`,
    balanceRow,
    tokensRow,
    `</div>`,
  ].join('');
}

function strategyLabel(s: BiddingStrategy | null): string {
  if (!s) return '';
  switch (s.kind) {
    case 'LEXICAL_JACCARD':
      return 'lex/jaccard';
    case 'CONSTANT_FLOOR':
      return `const-floor=${s.floor ?? '?'}`;
    case 'LORA_PARSER':
      return `lora:${s.model_id ?? '?'}`;
    case 'LLM_PASSTHROUGH':
      return `llm:${s.model_id ?? '?'}`;
    default:
      return s.kind.toLowerCase();
  }
}

function renderAuction(ev: KgViewEvent, manifest: BidderManifest | null): string {
  const bids = (ev.bids || []).slice().sort((a, b) => b.value - a.value);
  if (!bids.length) {
    return [
      `<details class="chat-auction">`,
      `<summary class="chat-auction-summary">auction</summary>`,
      `<div class="chat-auction-price">No bidders participated.</div>`,
      `</details>`,
    ].join('');
  }
  const byId = new Map<string, BidderEntry>(
    (manifest?.bidders || []).map((b) => [b.id, b]),
  );
  const rows = bids
    .map((b) => {
      const isWin = b.tool === ev.winner;
      const mark = isWin ? `<span class="winner-mark">✓</span>` : '';
      const entry = byId.get(b.tool) || null;
      const strat = entry
        ? `<span class="chat-auction-strategy">${esc(strategyLabel(entry.strategy))}</span>`
        : '';
      return [
        `<tr class="${isWin ? 'winner' : ''}">`,
        `<td>${mark}${esc(b.tool)}${strat}</td>`,
        `<td>${b.value.toFixed(4)}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('');
  const priceLine =
    ev.bids.length > 1
      ? `Vickrey price (2nd-highest bid): <b>${ev.price.toFixed(4)}</b>`
      : `Solo bidder; price <b>${ev.price.toFixed(4)}</b>`;
  return [
    `<details class="chat-auction">`,
    `<summary class="chat-auction-summary">auction (${bids.length} bidder${bids.length === 1 ? '' : 's'})</summary>`,
    `<table class="chat-auction-table">`,
    `<thead><tr><th>bidder</th><th>value</th></tr></thead>`,
    `<tbody>${rows}</tbody>`,
    `</table>`,
    `<div class="chat-auction-price">${priceLine}</div>`,
    `</details>`,
  ].join('');
}

function renderTriple(t: ChatTriple, bidder: string): string {
  return [
    `<div class="chat-triple">`,
    `<div class="chat-triple-spo">`,
    `${esc(t.subject)} `,
    `<span class="chat-triple-pred">${esc(t.predicate)}</span> `,
    `${esc(t.object)}`,
    `</div>`,
    `<div class="chat-triple-meta">via ${esc(bidder)}</div>`,
    `</div>`,
  ].join('');
}

export class MChatPanel extends HTMLElement {
  private source: EventSource | null = null;
  private turnsEl: HTMLDivElement | null = null;
  private triplesEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendEl: HTMLButtonElement | null = null;
  private drawerEl: HTMLDivElement | null = null;
  private seenEvents = new Set<number>();
  private manifest: BidderManifest | null = null;

  private balances: BalanceEntry[] = [];
  private tokens: TokenUsageEntry[] = [];

  static get observedAttributes(): string[] {
    return ['sse-url', 'turn-url', 'bidders-url', 'balances-url', 'token-usage-url'];
  }

  get sseUrl(): string {
    return this.getAttribute('sse-url') || '/api/noc-agent/view';
  }
  get turnUrl(): string {
    return this.getAttribute('turn-url') || '/api/noc-agent/turn';
  }
  get biddersUrl(): string {
    return this.getAttribute('bidders-url') || '/api/noc-agent/bidders';
  }
  get balancesUrl(): string {
    return this.getAttribute('balances-url') || '/api/noc-agent/balances';
  }
  get tokenUsageUrl(): string {
    return this.getAttribute('token-usage-url') || '/api/noc-agent/token-usage';
  }

  connectedCallback(): void {
    this.render();
    this.connectSse();
    void this.loadManifest();
    void this.loadBalances();
    void this.loadTokens();
  }

  disconnectedCallback(): void {
    this.source?.close();
    this.source = null;
  }

  attributeChangedCallback(name: string): void {
    if (name === 'sse-url' && this.isConnected) {
      this.source?.close();
      this.connectSse();
    }
  }

  private render(): void {
    this.innerHTML = [
      `<div class="chat-toolbar">`,
      `  <span class="chat-toolbar-title">agora loop</span>`,
      `  <button type="button" class="chat-toolbar-btn" data-bidders-btn>bidders</button>`,
      `</div>`,
      `<div class="chat-grid">`,
      `  <div class="chat-pane">`,
      `    <p class="chat-pane-title">turns</p>`,
      `    <div data-turns><p class="chat-empty">No turns yet. Type below to start.</p></div>`,
      `  </div>`,
      `  <div class="chat-pane">`,
      `    <p class="chat-pane-title">knowledge graph</p>`,
      `    <div data-triples><p class="chat-empty">Empty.</p></div>`,
      `  </div>`,
      `</div>`,
      `<form class="chat-input-row" data-form>`,
      `  <input class="chat-input" type="text" name="q" placeholder="ask a question…" autocomplete="off" />`,
      `  <button class="chat-send" type="submit">send</button>`,
      `</form>`,
      `<div class="chat-drawer-backdrop" data-drawer-backdrop></div>`,
      `<div class="chat-drawer" data-drawer aria-hidden="true">`,
      `  <div class="chat-drawer-head">`,
      `    <h3>bidder manifest</h3>`,
      `    <button type="button" class="chat-drawer-close" data-drawer-close aria-label="close">×</button>`,
      `  </div>`,
      `  <div data-drawer-body><p class="chat-empty">Loading…</p></div>`,
      `</div>`,
    ].join('');
    this.turnsEl = this.querySelector('[data-turns]') as HTMLDivElement;
    this.triplesEl = this.querySelector('[data-triples]') as HTMLDivElement;
    this.inputEl = this.querySelector('input.chat-input') as HTMLInputElement;
    this.sendEl = this.querySelector('button.chat-send') as HTMLButtonElement;
    this.drawerEl = this.querySelector('[data-drawer]') as HTMLDivElement;
    const form = this.querySelector('[data-form]') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });
    const openBtn = this.querySelector('[data-bidders-btn]') as HTMLButtonElement;
    openBtn.addEventListener('click', () => this.toggleDrawer(true));
    const closeBtn = this.querySelector('[data-drawer-close]') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.toggleDrawer(false));
    const backdrop = this.querySelector('[data-drawer-backdrop]') as HTMLDivElement;
    backdrop.addEventListener('click', () => this.toggleDrawer(false));
  }

  private toggleDrawer(open: boolean): void {
    if (!this.drawerEl) return;
    this.drawerEl.classList.toggle('open', open);
    this.drawerEl.setAttribute('aria-hidden', String(!open));
    const backdrop = this.querySelector('[data-drawer-backdrop]') as HTMLDivElement;
    backdrop?.classList.toggle('open', open);
  }

  private async loadManifest(): Promise<void> {
    try {
      const resp = await fetch(this.biddersUrl);
      if (!resp.ok) {
        console.warn('chat-panel: /bidders status', resp.status);
        return;
      }
      this.manifest = (await resp.json()) as BidderManifest;
      this.renderManifest();
    } catch (e) {
      console.warn('chat-panel: /bidders fetch failed', e);
    }
  }

  private renderManifest(): void {
    const body = this.querySelector('[data-drawer-body]') as HTMLDivElement;
    if (!body || !this.manifest) return;
    const balanceById = new Map<string, BalanceEntry>(
      this.balances.map((b) => [b.tool_id, b]),
    );
    const tokensById = new Map<string, TokenUsageEntry>(
      this.tokens.map((t) => [t.tool_id, t]),
    );
    const head = `<p class="chat-empty" style="font-style:normal;padding:0;margin:0 0 8px;">version: ${esc(this.manifest.version)} — ${this.manifest.bidders.length} bidders</p>`;
    body.innerHTML =
      head +
      this.manifest.bidders
        .map((b) =>
          renderBidder(b, balanceById.get(b.id) || null, tokensById.get(b.id) || null),
        )
        .join('');
  }

  private async loadBalances(): Promise<void> {
    try {
      const resp = await fetch(this.balancesUrl);
      if (!resp.ok) return;
      this.balances = (await resp.json()) as BalanceEntry[];
      this.renderManifest();
    } catch (e) {
      console.warn('chat-panel: /balances fetch failed', e);
    }
  }

  private async loadTokens(): Promise<void> {
    try {
      const resp = await fetch(this.tokenUsageUrl);
      if (!resp.ok) return;
      this.tokens = (await resp.json()) as TokenUsageEntry[];
      this.renderManifest();
    } catch (e) {
      console.warn('chat-panel: /token-usage fetch failed', e);
    }
  }

  private connectSse(): void {
    this.source = new EventSource(this.sseUrl);
    this.source.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as KgViewEvent;
        this.appendEvent(ev);
      } catch (e) {
        console.error('chat-panel: bad SSE frame', e, msg.data);
      }
    };
    this.source.onerror = (e) => {
      // EventSource auto-reconnects on transient errors; only
      // log the first one so we don't spam.
      console.warn('chat-panel: SSE error (will retry)', e);
    };
  }

  private appendEvent(ev: KgViewEvent): void {
    if (this.seenEvents.has(ev.event_id)) return;
    this.seenEvents.add(ev.event_id);
    // Refresh balances + token usage after each event — at least
    // one winner just got debited; if a parser/decomposer Claude
    // call ran, the token ledger moved too.
    void this.loadBalances();
    void this.loadTokens();

    if (this.turnsEl) {
      this.turnsEl.querySelector('.chat-empty')?.remove();
      this.turnsEl.insertAdjacentHTML('beforeend', renderTurn(ev, this.manifest));
      this.turnsEl.parentElement?.scrollTo({
        top: this.turnsEl.parentElement.scrollHeight,
      });
    }
    if (this.triplesEl && ev.delta?.length) {
      this.triplesEl.querySelector('.chat-empty')?.remove();
      const html = ev.delta.map((t) => renderTriple(t, ev.winner || '(unknown)')).join('');
      this.triplesEl.insertAdjacentHTML('beforeend', html);
      this.triplesEl.parentElement?.scrollTo({
        top: this.triplesEl.parentElement.scrollHeight,
      });
    }
  }

  private async send(): Promise<void> {
    const q = this.inputEl?.value.trim();
    if (!q || !this.sendEl) return;
    this.sendEl.disabled = true;
    try {
      const resp = await fetch(this.turnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (!resp.ok) {
        console.error('chat-panel: turn failed', resp.status, await resp.text());
        return;
      }
      // The SSE delivers the new event to appendEvent; we don't
      // render from the POST response on purpose — single source
      // of truth is the stream.
      if (this.inputEl) this.inputEl.value = '';
    } catch (e) {
      console.error('chat-panel: turn error', e);
    } finally {
      this.sendEl.disabled = false;
      this.inputEl?.focus();
    }
  }
}

/// Idempotent registration. Call once at app start.
export function registerChatPanel(): void {
  if (!customElements.get('m-chat-panel')) {
    customElements.define('m-chat-panel', MChatPanel);
  }
}
