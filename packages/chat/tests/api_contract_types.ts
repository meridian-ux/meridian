// Compile-only host consumer. Bazel resolves ../src to emitted declarations.
import type { ReactNode } from "react";
import { Conversation, BlockView, ConversationModel } from "../src/index.js";
import type {
  ConversationProps, ViewRenderer, ViewBlock, Block, ConversationEvent, TurnRequest,
  Role, StatusState, ToolState, Markdown, ContextLine, ToolBlock, ListItem,
  ListBlock, Field, Fields, Code, TableColumn, TableRow, TableBlock, Status,
  TurnDone, TurnError,
} from "../src/index.js";
import { MAssistantPanel, registerAssistantPanel } from "../src/web.js";
import type { ConversationEvent as WebEvent } from "../src/web.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type Props = Assert<Equal<keyof ConversationProps,
  "sseUrl" | "turnUrl" | "className" | "emptyState" | "placeholder" |
  "renderView" | "initialMessage">>;
export type PropTypes = Assert<Equal<ConversationProps, {
  sseUrl?: string; turnUrl?: string; className?: string; emptyState?: ReactNode;
  placeholder?: string; renderView?: ViewRenderer; initialMessage?: string;
}>>;
export type ViewSeam = Assert<Equal<ViewRenderer, (view: ViewBlock, block: Block) => ReactNode>>;
export type WireSeam = Assert<Equal<ConversationEvent, WebEvent>>;
export type EventShape = Assert<Equal<keyof ConversationEvent, "seq" | "block" | "status" | "done" | "error">>;
export type Sequence = Assert<Equal<ConversationEvent["seq"], number | string | undefined>>;
export type Turn = Assert<Equal<TurnRequest, { message: string; conversationId?: string }>>;
export type Submit = Assert<Equal<MAssistantPanel["submit"], (text?: string) => void>>;
export type Registration = Assert<Equal<typeof registerAssistantPanel, () => void>>;
export type RootRender = Assert<Equal<typeof Conversation, (props: ConversationProps) => ReactNode>>;
export type BlockRender = Assert<Equal<Parameters<typeof BlockView>[0], { block: Block; renderView?: ViewRenderer }>>;
export type Ingest = Assert<Equal<ConversationModel["ingest"], (event: ConversationEvent) => boolean>>;
export type Reset = Assert<Equal<ConversationModel["reset"], () => void>>;
export type Blocks = Assert<Equal<ConversationModel["blocks"], Block[]>>;
export type LiveStatus = Assert<Equal<ConversationModel["status_"], Status | null>>;
export type LastError = Assert<Equal<ConversationModel["error_"], string | null>>;
// Keep all named wire imports consumer-reachable, including type-only exports.
export type WireTypes = [Role, StatusState, ToolState, Markdown, ContextLine,
  ToolBlock, ListItem, ListBlock, Field, Fields, Code, TableColumn, TableRow,
  TableBlock, Status, TurnDone, TurnError];
