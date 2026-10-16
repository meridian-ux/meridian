// Browser bundle entry for meridian-chat (the VANILLA tier). esbuild bundles this
// into a single self-contained ESM (`meridian_chat.bundle.js`) that bundler-free
// hosts (botnoc's static frontend) load directly and:
//   import { registerAssistantPanel, ASSISTANT_PANEL_CSS } from "…"
// It has no React dependency. Shared schema formatting and protobuf decoding
// are bundled; the public conversation wire types remain structural JSON.

export {
  ASSISTANT_PANEL_CSS,
  MAssistantPanel,
  registerAssistantPanel,
} from "./assistant_panel.js";
