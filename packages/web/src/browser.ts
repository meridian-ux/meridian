// Browser bundle entry for meridian-web.
//
// This is the entry esbuild bundles into a SINGLE self-contained ESM
// (`meridian_web.bundle.js`) that hosts load directly in the browser — no
// bundler on the host side. esbuild inlines @bufbuild/protobuf and
// @savvifi/meridian-proto-ts, so the output has NO bare `@…` imports to resolve.
//
// It is the renderer surface for a host that drives meridian panels itself
// (e.g. botnoc's plugin shell): the PanelDescriptor renderer (table / lro /
// adhoc), the chat-panel web component, and two thin codec helpers that replace
// the wasm conveniences the path-B binary boundary removed:
//   * `decodeBundle(bytes)`   — was the wasm `decodePanelBundle`.
//   * `encodeGalleryPanel(spec)` — wire bytes for the wasm `renderGalleryPanel`
//     (renderPanel itself does not draw galleries; hosts that show a gallery get
//     the formatted cards from the wasm and lay them out themselves).

import {
  create,
  fromBinary,
  toBinary,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import {
  GalleryPanelSchema,
  type GalleryPanel,
} from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import {
  PanelBundleSchema,
  type PanelBundle,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";

// The PanelDescriptor renderer (table / lro / adhoc / form) + its host-facing types.
export {
  SUPPORTED_BODIES,
  disposePanel,
  renderPanel,
  supportsBody,
} from "./uiview/renderer.js";
export type { SupportedBody } from "./uiview/renderer.js";
export { webComponentsRenderer } from "./uiview/web_components_renderer.js";
export type {
  RenderedRow,
  RenderPanelOptions,
  UiviewWasm,
} from "./uiview/renderer.js";
// The composition/layout tier: renders a ViewDescriptor (layout of panels).
export { renderView } from "./uiview/view_renderer.js";
export type { RenderViewOptions } from "./uiview/view_renderer.js";

// The framework-neutral transport contracts the host implements (type-only;
// erased at build time — re-exported so hosts can import them from the bundle).
export type { RenderContext, RpcInvoker } from "@savvifi/meridian-schemas/uiview";

// The chat-panel web component (lazy-registered by hosts that show chat panels).
export { CHAT_PANEL_CSS, MChatPanel, registerChatPanel } from "./chat_panel.js";

// The assistant-panel web component — the GENERIC MCP-host chat plane (chat.v1),
// as opposed to the agora-loop <m-chat-panel>. Lazy-registered by hosts.
export {
  ASSISTANT_PANEL_CSS,
  MAssistantPanel,
  registerAssistantPanel,
} from "./assistant_panel.js";

// The terminal primitive — xterm.js spliced to a pty over a WebSocket. Drives the
// `terminal` PanelDescriptor arm (via renderPanel) and is exported directly so
// hosts can mount a terminal inside a bespoke (adhoc) view — e.g. a dev-workspace
// card that launches a tool session in place. xterm is inlined into this bundle.
export {
  TERMINAL_PANEL_CSS,
  injectTerminalCss,
  renderTerminalPanel,
} from "./terminal_panel.js";
export type { TerminalHandle, TerminalSpec } from "./terminal_panel.js";

// Canonical message types the host reads off a decoded bundle.
export type { GalleryPanel, PanelBundle, PanelDescriptor };

/**
 * Decode a wire `meridian.ui.v1.PanelBundle` (the `.binpb` a plugin serves).
 * Replaces the wasm `decodePanelBundle` the path-B boundary dropped: the bundle
 * crosses as protobuf binary and is decoded here with protobuf-es (no wasm,
 * no serde-JSON DTO). Returns the canonical message — `bundle.panels` are typed
 * `PanelDescriptor`s with the `body` oneof as `{ case, value }`.
 */
export function decodeBundle(bytes: Uint8Array): PanelBundle {
  return fromBinary(PanelBundleSchema, bytes);
}

/**
 * Build the wire bytes for a `GalleryPanel` to hand the wasm `renderGalleryPanel`
 * (which returns the formatted cards). `spec` is a partial canonical GalleryPanel
 * (camelCase fields, e.g. `rowsField`, `card: { titleField, ... }`).
 */
export function encodeGalleryPanel(
  spec: MessageInitShape<typeof GalleryPanelSchema>,
): Uint8Array {
  return toBinary(GalleryPanelSchema, create(GalleryPanelSchema, spec));
}
