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
export declare function isActiveStatus(state: StatusState | undefined): boolean;
