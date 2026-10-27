import { create, toJson } from "@bufbuild/protobuf";
import { ConversationEventSchema } from "@savvifi/meridian-proto-ts/proto/conversation_pb.js";
import { registerAssistantPanel, ASSISTANT_PANEL_CSS } from "../src/assistant_panel.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { renderPanel, type UiviewWasm } from "../src/uiview/renderer.js";
import { renderView } from "../src/uiview/view_renderer.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { applyTheme } from "../theme/web/theme.js";
import { toneCases } from "../../../schemas/conformance/tone_cases.js";
import { withRetiredTrap } from "./retired_wire.js";

// Runtime test controls only. Descriptors remain canonical protobuf messages;
// the local fake transport uses the renderer's established JSON RPC contract.
const wasm: UiviewWasm = {
  renderTable: () => [], buildPopulateRequest: () => ({}), readPath: () => null,
  buildRequest: () => ({}), renderTablePanel: () => [], formatLroMetadata: () => "",
};
const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const root = () => document.getElementById("root")!;
const controls = {
  resourceSettle: () => {},
  resourceInvocation: (mode: "allow" | "deny" | "pending") => {
    const container = root(); container.dataset.resourceCalls = "0"; container.dataset.resourceAborted = "false";
    controls.resourceSettle = () => {};
    return renderPanel({ root: container, wasm, context,
      descriptor: create(PanelDescriptorSchema, { body: { case: "resourceCards", value: {
        populate: { service: "fixture.Resource", method: "List" }, rowsField: "items", template: { titleField: "name", actions: { actions: [
          { id: "use", label: "Use resource", style: 3, invoke: { service: "fixture.Resource", method: "Get", bindings: [
            { requestField: "id", source: { case: "rowField", value: "id" } }, { requestField: "flag", source: { case: "rowField", value: "flag" } },
          ] }, confirm: { title: "Use this resource?", message: "Literal <b>resource</b>", confirmLabel: "Accept resource", destructive: true } },
          { id: "other", label: "Other resource action", invoke: { service: "fixture.Resource", method: "Get" } },
        ] } },
      } } }), invoker: { invoke: async (_service, method) => { if (method !== "List") throw Error("No default mutation fallback"); return { items: [{ id: 0, name: "Resource zero", flag: false }] }; } },
      admission: { reads: ["fixture.Resource/List"], mutations: mode === "deny" ? [] : ["fixture.Resource/Get"] },
      invocation: { capabilities: { rpc: { invoke: async (_service, _method, request, signal) => {
        container.dataset.resourceCalls = String(Number(container.dataset.resourceCalls) + 1); container.dataset.resourceRequest = JSON.stringify(request);
        signal.addEventListener("abort", () => { container.dataset.resourceAborted = "true"; }, { once: true });
        if (mode === "pending") await new Promise<void>(resolve => { controls.resourceSettle = resolve; }); return {};
      } } } },
    });
  },
  tableSettle: () => {},
  tableInvocation: (mode: "allow" | "deny" | "pending") => {
    const container = root(); container.dataset.tableCalls = "0"; container.dataset.tableAborted = "false";
    controls.tableSettle = () => {};
    const rows = [{ raw: { id: 0, name: "first" }, cells: ["First row"] }, { raw: { id: 2, name: "second" }, cells: ["Second row"] }];
    return renderPanel({ root: container, wasm: { ...wasm, renderTable: () => rows }, context,
      descriptor: withRetiredTrap(create(PanelDescriptorSchema, { body: { case: "table", value: {
        populate: { service: "fixture.Rows", method: "List" }, columns: [{ header: "Name", fieldPath: "name" }],
        affordances: { items: [{ label: "Use row", invoke: { case: "copy", value: "canonical" } }, { label: "Other row action", invoke: { case: "copy", value: "other" } }] },
      } } })), invoker: { invoke: async (service) => { if (service !== "fixture.Rows") throw Error("Legacy fallback"); return {}; } },
      invocation: { admit: () => mode !== "deny", capabilities: { copy: async (_target, current, signal) => {
        container.dataset.tableCalls = String(Number(container.dataset.tableCalls) + 1); container.dataset.tableRow = String((current.selectedRow as { id: number }).id);
        signal.addEventListener("abort", () => { container.dataset.tableAborted = "true"; }, { once: true });
        if (mode === "pending") await new Promise<void>(resolve => { controls.tableSettle = resolve; });
      } } },
    });
  },
  formSettle: () => {},
  formInvocation: (mode: "allow" | "deny" | "pending") => {
    const container = root(); container.dataset.formCalls = "0"; container.dataset.formAborted = "false";
    controls.formSettle = () => {};
    return renderPanel({ root: container, wasm, context,
      descriptor: withRetiredTrap(create(PanelDescriptorSchema, { body: { case: "form", value: { mode: 2,
        submitAffordance: { label: "Save current", invoke: { case: "copy", value: "canonical literal" } },
        fields: [{ fieldId: "name", label: "Name", kind: { case: "text", value: { defaultValue: "initial", minLength: 2 } } }],
      } } })), invoker: { invoke: async () => { throw Error("No legacy RPC in canonical form"); } },
      invocation: { admit: () => mode !== "deny", capabilities: { copy: async (_target, current, signal) => {
        container.dataset.formCalls = String(Number(container.dataset.formCalls) + 1);
        container.dataset.formValue = String(current.formValues.name);
        signal.addEventListener("abort", () => { container.dataset.formAborted = "true"; }, { once: true });
        if (mode === "pending") await new Promise<void>(resolve => { controls.formSettle = resolve; });
      } } },
    });
  },
  invocationSettle: () => {},
  invocation: (mode: "allow" | "deny" | "pending") => {
    const container = root(); container.dataset.calls = "0"; container.dataset.aborted = "false";
    controls.invocationSettle = () => {};
    return renderPanel({ root: container, wasm, context,
      descriptor: create(PanelDescriptorSchema, { body: { case: "action", value: { action: {
        label: "Admitted copy", description: "Typed host capability", invoke: { case: "copy", value: "raw/literal" },
      } } } }), invoker: { invoke: async () => { throw Error("No RPC in this fixture"); } },
      invocation: { admit: () => mode !== "deny", capabilities: { copy: async (_value, _context, signal) => {
        container.dataset.calls = String(Number(container.dataset.calls) + 1);
        signal.addEventListener("abort", () => { container.dataset.aborted = "true"; }, { once: true });
        if (mode === "pending") await new Promise<void>(resolve => { controls.invocationSettle = resolve; });
      } } },
    });
  },
  viewCalls: [] as string[],
  viewLayout: (mode: "tabbed" | "twoColumn") => {
    controls.viewCalls.length = 0;
    const table = (method: string) => ({ body: { case: "table" as const, value: {
      populate: { service: "fixture.View", method }, rowsField: "items", placeholder: `${method} body`,
    } } });
    return renderView({ root: root(), wasm, context,
      view: create(ViewDescriptorSchema, { id: "layout", title: "View layout", layout: { mode: { case: mode, value: {} } }, slots: [
        { id: "header", title: "Pinned header", placement: { headerRow: true, tabLabel: "Not a tab" } },
        { id: "region", title: "Persistent region", position: 1 },
        { id: "same", title: "Main section", position: 2, placement: { tabLabel: "Alpha " + "long-label".repeat(25) }, panel: table("Alpha") },
        { id: "same", title: "Sidebar section", position: 3, placement: { column: 2, tabPosition: 1, tabLabel: "Beta " + "long-label".repeat(25) }, panel: table("Beta") },
      ] }), invoker: { invoke: async (_service, method) => { controls.viewCalls.push(method); return {}; } },
    });
  },
  toneCases,
  affordance: (tone?: number, emphasis?: number, denied = false) => {
    root().dataset.destination = "";
    applyTheme({ typography: { heading_weight: 700, body_weight: 500 } }, "light", root());
    return renderPanel({ root: root(), wasm, context,
    descriptor: create(PanelDescriptorSchema, { body: { case: "action", value: { action: {
      label: "Presentation action", tone, emphasis,
      invoke: { case: "uri", value: denied ? "javascript:alert(1)" : "/next" },
    } } } }),
    invoker: { invoke: async () => { throw new Error("Presentation cannot invoke an RPC"); } },
    invocation: { admit: () => true, capabilities: { uri: async uri => { root().dataset.destination = uri; } } },
    });
  },
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
  metricsScale: () => applyTheme({ metrics: {
    spacing_scale_px: [0, 2, 6, 12, 18, 24, 36], density_scale: 0.75, stroke_px: 0,
  } }, "light", root()),
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
