import { create, toJson } from "@bufbuild/protobuf";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { registerAssistantPanel, ASSISTANT_PANEL_CSS } from "../src/assistant_panel.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { renderPanel, type UiviewWasm } from "../src/uiview/renderer.js";
import { applyTheme } from "../theme/web/theme.js";

// Runtime test controls only. Descriptors remain canonical protobuf messages;
// the local fake transport uses the renderer's established JSON RPC contract.
const wasm: UiviewWasm = {
  renderTable: () => [], buildPopulateRequest: () => ({}), readPath: () => null,
  buildRequest: () => ({}), renderTablePanel: () => [], formatLroMetadata: () => "",
};
const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const root = () => document.getElementById("root")!;
const controls = {
  conversationTone: (tone?: number, state: 0 | 1 | 2 = 2) => {
    if (!document.getElementById("conversation-styles")) {
      const style = document.createElement("style");
      style.id = "conversation-styles";
      style.textContent = ASSISTANT_PANEL_CSS;
      document.head.append(style);
    }
    let source!: { onmessage: ((event: MessageEvent) => void) | null };
    const original = globalThis.EventSource;
    globalThis.EventSource = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      constructor() { source = this; }
      close() {}
    } as unknown as typeof EventSource;
    try {
      registerAssistantPanel();
      root().replaceChildren(document.createElement("m-assistant-panel"));
      for (const event of [
        create(ConversationEventSchema, { seq: 1n, event: { case: "block", value: {
          blockId: "tone", role: "assistant", kind: { case: "tool", value: { name: "Task", state, tone } },
        } } }),
        create(ConversationEventSchema, { seq: 2n, event: { case: "status", value: { state: 3, detail: "Working", tone } } }),
      ]) source.onmessage!(new MessageEvent("message", { data: JSON.stringify(toJson(ConversationEventSchema, event, { enumAsInteger: true })) }));
    } finally { globalThis.EventSource = original; }
  },
  typography: () => applyTheme({ typography: {
    sans: "sans-serif", base_size_px: 19, heading_weight: 700, body_weight: 500,
  } }, "light", root()),
  metrics: () => applyTheme({ metrics: { unit_px: 16, radius_px: 20 } }, "light", root()),
  resetTheme: () => applyTheme({}, "light", root()),
  gallery: () => renderPanel({ root: root(), wasm, context,
    descriptor: create(PanelDescriptorSchema, { panelId: "gallery-layout", body: { case: "gallery", value: {
      populate: { service: "fixture.Gallery", method: "List" }, rowsField: "data.items",
      card: { titleField: "profile.name", subtitleField: "description", imageField: "image", hrefField: "href", actionLabelField: "action" },
    } } }),
    invoker: { invoke: async () => ({ data: { items: Array.from({ length: 3 }, (_, index) => ({
      profile: { name: `Card ${index + 1}` }, description: "long-unbroken-value".repeat(12),
      image: "https://assets.meridian.invalid/gallery.svg", href: `/cards/${index + 1}`, action: `Open card ${index + 1}`,
    })) } }) },
  }),
  steps: () => renderPanel({ root: root(), wasm, context,
    descriptor: create(PanelDescriptorSchema, { panelId: "step-failure", body: { case: "steps", value: {
      intro: "Start here", outro: "Finish here", steps: [
        { label: "First", actor: "Admin", detail: "Keep the narration", mediaUri: "https://assets.meridian.invalid/broken.png", mediaAlt: "Keep the frame summary", action: { label: "Continue", invoke: { case: "uri", value: "/next" } } },
        { label: "Second", actor: "Reviewer", detail: "Review the result" },
      ],
    } } }), invoker: { invoke: async () => { throw new Error("Steps must not invoke RPCs"); } },
  }),
};
declare global { interface Window { webConformance: typeof controls } }
window.webConformance = controls;
