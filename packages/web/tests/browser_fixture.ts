import { create } from "@bufbuild/protobuf";
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
  typography: () => applyTheme({ typography: {
    sans: "sans-serif", base_size_px: 19, heading_weight: 700, body_weight: 500,
  } }, "light", root()),
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
