import { type Block, type ConversationEvent, type Status } from "./wire.js";
export declare class ConversationModel {
    private order;
    private byId;
    private seen;
    private status;
    private error;
    /**
     * Apply one event. Returns true if it changed state, false if it was a
     * duplicate (already-seen seq) and was ignored.
     */
    ingest(ev: ConversationEvent): boolean;
    /** Blocks in arrival order (each the latest version for its blockId). */
    get blocks(): Block[];
    /** The current live status, or null when idle/cleared. */
    get status_(): Status | null;
    /** The last turn error, or null. */
    get error_(): string | null;
    reset(): void;
}
