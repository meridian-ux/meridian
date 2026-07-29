// @savvifi/meridian-chat — the conversation / agent-chat renderer of the meridian
// renderer family. Renders a meridian.ui.v1 Conversation stream (conversation.proto
// — the neutral promotion of botnoc chat.v1) over SSE + POST.
//
// The main entry is the REACT tier (<Conversation>) + the renderer-neutral core.
// The vanilla <m-assistant-panel> web component is at the "./web" subpath (no React
// dependency), and the bundler-free browser bundle is the Bazel //src:browser_bundle.

export { Conversation, type ConversationProps } from "./conversation.js";
export { BlockView, type ViewRenderer } from "./render_react.js";
export { ConversationModel } from "./model.js";
export { CONVERSATION_CSS } from "./styles.js";
export * from "./wire.js";
