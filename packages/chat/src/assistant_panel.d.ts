import { ASSISTANT_PANEL_CSS } from "./styles.js";
export { ASSISTANT_PANEL_CSS };
export declare class MAssistantPanel extends HTMLElement {
    private source;
    private logEl;
    private statusEl;
    private inputEl;
    private sendEl;
    private blocks;
    private seen;
    static get observedAttributes(): string[];
    get sseUrl(): string;
    get turnUrl(): string;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string): void;
    private render;
    private connectSse;
    private handle;
    private upsertBlock;
    private appendError;
    private renderStatus;
    private scrollDown;
    /**
     * Send a message. With no argument, sends the composer's current value (the
     * form-submit path). With `text`, sets the composer to it first — the clean
     * imperative entry point for a host driving the panel (e.g. a voice layer), an
     * alternative to reaching into `input.asst-text` + `form.requestSubmit()`.
     */
    submit(text?: string): void;
    private send;
}
/** Idempotent registration. Call once at app start. */
export declare function registerAssistantPanel(): void;
