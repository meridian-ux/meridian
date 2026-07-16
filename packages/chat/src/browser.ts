// Browser bundle entry for meridian-chat (the VANILLA tier). esbuild bundles this
// into a single self-contained ESM (`meridian_chat.bundle.js`) that bundler-free
// hosts (botnoc's static frontend) load directly and:
//   import { registerAssistantPanel, ASSISTANT_PANEL_CSS } from "…"
// It has NO framework dependency (no React, no protobuf-es) — the wire types are
// structural — so the bundle is tiny.

export {
  ASSISTANT_PANEL_CSS,
  MAssistantPanel,
  registerAssistantPanel,
} from "./assistant_panel.js";
