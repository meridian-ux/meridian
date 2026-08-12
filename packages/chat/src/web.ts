// @savvifi/meridian-chat/web — the VANILLA (framework-free) tier: the
// <m-assistant-panel> web component + the shared renderer-neutral core. No React.
// This is what botnoc consumes (via the esbuild browser bundle).

export {
  ASSISTANT_PANEL_CSS,
  MAssistantPanel,
  registerAssistantPanel,
} from "./assistant_panel.js";
export { renderBlockInner } from "./render_html.js";
export { escHtml, mdInline, shortName } from "./dom.js";
export { ConversationModel } from "./model.js";
export * from "./wire.js";
