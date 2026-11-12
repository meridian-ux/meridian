import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://staging.invalid/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "customElements", "HTMLCanvasElement",
  "HTMLTextAreaElement", "HTMLInputElement", "HTMLSelectElement", "MutationObserver", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
dom.window.HTMLElement.prototype.scrollTo = () => {};
globalThis.EventSource = class { close() {} };

const { create, fromJson, toBinary } = await import("@bufbuild/protobuf");
const { LaunchpadSchema } = await import("@meridian-ux/proto-ts/proto/command_palette_pb.js");
const { ViewDescriptorSchema } = await import("@meridian-ux/proto-ts/proto/view_pb.js");
const { staticViewText } = await import("@meridian-ux/schemas/uiview");
const { renderView, disposeView } = await import("@meridian-ux/web");
const { reactWebRenderer, MeridianProvider, htmlKit } = await import("@meridian-ux/web-react");
const { muiKit } = await import("@meridian-ux/mui-kit");
const { Conversation } = await import("@meridian-ux/chat");
const { Launchpad } = await import("@meridian-ux/launchpad");
const { createElement } = await import("react");
const { createRoot } = await import("react-dom/client");

const webDir = "node_modules/@meridian-ux/web";
const manifest = JSON.parse(readFileSync(webDir + "/package.json"));
for (const entry of Object.values(manifest.exports)) {
  for (const path of typeof entry === "string" ? [entry] : Object.values(entry)) {
    assert(readFileSync(webDir + "/" + path).length > 0, path);
  }
}
assert(JSON.parse(readFileSync(webDir + "/src/worker-command.schema.json")));
const catalog = JSON.parse(readFileSync("projector-catalog.json", "utf8"));
const requestName = "method.meridian.proto.v1.ProjectionService.RefreshTarget";
const request = catalog.entries.find(entry => entry.name === requestName);
assert(request, "missing reviewed projector request view");
const view = fromJson(ViewDescriptorSchema, request.view);
const descriptor = view.slots.find(slot => slot.id === "request").panel;
assert.match(staticViewText(toBinary(ViewDescriptorSchema, view)), /Refresh Target/);
console.log("Installed browser exports, worker schema and embedded WASM initialized");

const mount = () => document.body.appendChild(document.createElement("div"));
async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

const web = mount();
const calls = [];
const invoker = { invoke: async (...args) => { calls.push(args); return {}; } };
const context = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: { ignored: true } };
const admission = { mutations: ["meridian.proto.v1.ProjectionService/RefreshTarget"] };
await renderView({ root: web, view, wasm: {}, context, invoker, admission,
  invocation: { context, admit: () => true } });
assert.match(web.textContent, /Refresh Target/);
assert.equal(calls.length, 0);
const input = web.querySelector('input[name="name"]');
assert(input, web.textContent);
assert.equal(input.value, "");
const resource = "targets/staging-target";
input.value = resource;
web.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
await until(() => calls.length > 0, "Installed request view did not submit: " + web.textContent);
assert.deepEqual(calls.map(call => call.slice(0, 3)), [["meridian.proto.v1.ProjectionService", "RefreshTarget", { name: resource }]]);
disposeView(web);
console.log("Installed web request view rendered and submitted edited data through WASM");

const mui = mount();
const panel = reactWebRenderer(muiKit).mount({ container: mui, descriptor, invoker, admission });
await until(() => mui.querySelector(".MuiFormControl-root") && mui.textContent.includes("Name *"),
  "Installed React/MUI renderer did not render the form");
panel.unmount();

const chat = mount();
const chatRoot = createRoot(chat);
chatRoot.render(createElement(Conversation, { placeholder: "Staging composer" }));
await until(() => chat.querySelector('[placeholder="Staging composer"]'), "Installed chat did not render");
chatRoot.unmount();

const launchpad = mount();
const launchpadRoot = createRoot(launchpad);
launchpadRoot.render(createElement(MeridianProvider, { kit: htmlKit, invoker, adhoc: {} }, createElement(Launchpad, { open: true, onClose: () => {},
  descriptor: create(LaunchpadSchema, { groups: [{ id: "commands", commands: [{ id: "open", title: "Open staging" }] }] }),
})));
await until(() => document.querySelector('[role="option"]')?.textContent.includes("Open staging"),
  "Installed launchpad did not render a command");
launchpadRoot.unmount();
dom.window.close();
console.log("Installed React/MUI, chat and launchpad rendered");
