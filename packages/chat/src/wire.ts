// The conversation wire shape — the proto3-JSON of meridian.ui.v1.ConversationEvent
// (conversation.proto in meridian-schemas, the neutral promotion of botnoc chat.v1).
//
// These are STRUCTURAL types (not the protobuf-es messages) so the renderer has no
// protobuf-es runtime dependency and the web-component bundle stays tiny. They are
// kept byte-aligned to the canonical proto by a conformance test that feeds real
// `toJson(ConversationEventSchema, …)` output through the model. Field names are
// the proto3-JSON localNames (camelCase); `seq` may arrive as a number (botnoc's
// hand-built JSON) or a string (canonical proto3-JSON for uint64).

export type Role = "user" | "assistant";
export type StatusState = "STATE_UNSPECIFIED" | "IDLE" | "THINKING" | "WORKING";
export type ToolState = "RUNNING" | "OK" | "ERROR";

export interface Markdown {
  text?: string;
}
export interface ContextLine {
  icon?: string;
  text?: string;
}
export interface ToolBlock {
  name?: string;
  argsJson?: string;
  state?: ToolState;
  summary?: string;
}
export interface ListItem {
  title?: string;
  subtitle?: string;
  badges?: string[];
  icon?: string;
}
export interface ListBlock {
  title?: string;
  items?: ListItem[];
}
export interface Field {
  key?: string;
  value?: string;
}
export interface Fields {
  fields?: Field[];
}
export interface Code {
  language?: string;
  text?: string;
}
export interface TableColumn {
  key?: string;
  label?: string;
}
export interface TableRow {
  cells?: Record<string, string>;
}
export interface TableBlock {
  title?: string;
  columns?: TableColumn[];
  rows?: TableRow[];
}

/** One rendered unit. `blockId` is stable: re-sending updates the shown block. */
/**
 * A composed-UI block: `meridian.ui.v1.ViewDescriptor` as proto3-JSON.
 *
 * Deliberately OPAQUE. Typing this as the generated `ViewDescriptor` would put
 * `@savvifi/meridian-proto-ts` in this package's public `.d.ts`, turning a
 * dev-only dependency into a real one — and this package's whole point is that a
 * host can drop it in with no protobuf runtime. Worse, protobuf-es types are
 * NOMINAL, so a host resolving a different proto-ts minor than this package
 * declared would find two mutually unassignable `ViewDescriptor`s and nothing
 * would typecheck. That has shipped here before.
 *
 * So the descriptor passes through untyped and the HOST decodes it, against
 * whichever single proto-ts copy it actually resolves — see `renderView`.
 */
export type ViewBlock = Record<string, unknown>;

export interface Block {
  blockId?: string;
  role?: Role;
  markdown?: Markdown;
  context?: ContextLine;
  tool?: ToolBlock;
  list?: ListBlock;
  fields?: Fields;
  code?: Code;
  divider?: Record<string, never>;
  table?: TableBlock;
  view?: ViewBlock;
}

export interface Status {
  state?: StatusState;
  detail?: string;
}
export interface TurnDone {
  stopReason?: string;
}
export interface TurnError {
  message?: string;
}

/** One event in the answer stream (SSE, one per `data:` frame). */
export interface ConversationEvent {
  seq?: number | string;
  block?: Block;
  status?: Status;
  done?: TurnDone;
  error?: TurnError;
}

/** POST /turn body. */
export interface TurnRequest {
  message: string;
  conversationId?: string;
}

/** Whether a status is a live (shown) indicator vs cleared/idle. */
export function isActiveStatus(state: StatusState | undefined): boolean {
  return state === "THINKING" || state === "WORKING";
}
