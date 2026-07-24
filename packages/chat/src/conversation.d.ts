import type { ReactNode } from "react";
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
}
export declare function Conversation({ sseUrl, turnUrl, className, emptyState, placeholder, }: ConversationProps): ReactNode;
