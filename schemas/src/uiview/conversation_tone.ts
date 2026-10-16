/** Runtime projection of canonical Tone JSON, not a serialized DTO. Missing
 * presence preserves legacy styling; explicit unspecified/unknown is neutral. */
export function conversationToneRole(tone: unknown): string | undefined {
  if (tone === undefined || tone === null) return undefined;
  const names = ["UNSPECIFIED", "NEUTRAL", "INFO", "SUCCESS", "WARNING", "DANGER", "ACCENT"];
  const index = typeof tone === "number" ? tone :
    typeof tone === "string" ? names.findIndex(name => tone === `TONE_${name}`) : -1;
  return Number.isInteger(index) && index >= 1 && index < names.length ? names[index]!.toLowerCase() : "neutral";
}

export function conversationToolState(state: unknown): "RUNNING" | "OK" | "ERROR" {
  if (state === 1 || state === "OK") return "OK";
  if (state === 2 || state === "ERROR") return "ERROR";
  return "RUNNING";
}

export function conversationStatusState(state: unknown): "THINKING" | "WORKING" | "IDLE" {
  if (state === 2 || state === "THINKING") return "THINKING";
  if (state === 3 || state === "WORKING") return "WORKING";
  return "IDLE";
}

// Shared by both assistant web components and the React conversation stylesheet.
// Every attribute value comes from the closed role projection above, never CSS
// authored by a producer. State labels/markers remain independent of color.
export const CONVERSATION_TONE_CSS = [
  ["neutral", "var(--mer-fg, var(--text, #e5e7eb))"],
  ["info", "var(--mer-info, var(--info, #38bdf8))"],
  ["success", "var(--mer-success, var(--success, #22c55e))"],
  ["warning", "var(--mer-warning, var(--warning, #f59e0b))"],
  ["danger", "var(--mer-danger, var(--danger, #ef4444))"],
  ["accent", "var(--mer-accent, var(--accent, #6366f1))"],
].map(([role, color]) => `
  :is(m-assistant-panel, .meridian-conversation) .tool[data-mer-tone="${role}"], :is(m-assistant-panel, .meridian-conversation) .status[data-mer-tone="${role}"] { --mer-conversation-tone: ${color}; color: var(--mer-conversation-tone); }
`).join("") + `
  :is(m-assistant-panel, .meridian-conversation) .tool[data-mer-tone] { border-color: color-mix(in srgb, var(--mer-conversation-tone) 45%, transparent); background: color-mix(in srgb, var(--mer-conversation-tone) 10%, transparent); }
  :is(m-assistant-panel, .meridian-conversation) .tool[data-mer-tone] .tname { color: inherit; }
  :is(m-assistant-panel, .meridian-conversation) .tool[data-mer-tone] .dot { color: inherit; background: currentColor; }
  :is(m-assistant-panel, .meridian-conversation) .tool[data-mer-tone] .spin, :is(m-assistant-panel, .meridian-conversation) .status[data-mer-tone] .spin { border-top-color: currentColor; }
`;
