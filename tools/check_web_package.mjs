// Exercise actual tarballs from a detached npm consumer, never workspace links.
// This is a local install/pack check, not npm publish or registry configuration.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const repo = resolve(import.meta.dirname, "..");
const staging = mkdtempSync(join(tmpdir(), "meridian-web-package-"));
// Historical traps use the immutable additive descriptor, never removed v1
// exports or silently ignored JSON keys. This does not activate a FILE baseline.
const frozen = readFileSync(join(repo, "schemas/compat/v1-additive-pre-removal.binpb"));
assert.equal(createHash("sha256").update(frozen).digest("hex"), "6dfcee54b85b39b59c4b1bb17d241a02eccfa37441d5c742db480b87c1e0a968");
writeFileSync(join(staging, "frozen-additive.binpb"), frozen);
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const archives = [];
for (const [name, source] of [
  ["proto-ts", "schemas/proto/proto_ts_pkg"],
  ["schemas", "schemas/schemas_pkg"],
  ["web", "packages/web/pkg"],
]) {
  const target = join(staging, name);
  cpSync(join(repo, "bazel-bin", source), target, { recursive: true, dereference: true });
  const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  assert(!manifest.private, `${name} must not be private in the artifact`);
  assert(!JSON.stringify(manifest).includes("workspace:"));
  const [pack] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", staging], target));
  if (name === "web") {
    const files = new Set(pack.files.map(file => file.path));
    for (const entry of Object.values(manifest.exports)) {
      for (const path of typeof entry === "string" ? [entry] : Object.values(entry)) {
        assert(files.has(path.replace(/^\.\//, "")), `missing exported artifact ${path}`);
      }
    }
    assert(files.has("src/types/global.d.ts"), "toolkit declarations need their type module");
    assert(files.has("src/worker-command.schema.json"));
    assert(![...files].some(file => file.endsWith(".ts") && !file.endsWith(".d.ts")));
  }
  archives.push(join(staging, pack.filename));
}
writeFileSync(join(staging, "package.json"), JSON.stringify({ private: true, type: "module" }));
// protobuf-es 2.12.1 declarations use generic typed arrays (TypeScript 5.7+).
// The workspace's 5.6 compiler skips library checking; the consumer must not.
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...archives, "jsdom@25.0.1", "typescript@5.7.3", "esbuild@0.21.5"], staging);
const coreDeclarations = readFileSync(join(staging, "node_modules/@savvifi/meridian-schemas/src/uiview/core_runtime.d.ts"), "utf8");
assert(!coreDeclarations.includes("generated/meridian_uiview"), "public core signatures must not expose private wasm-bindgen declaration types");

writeFileSync(join(staging, "consumer.ts"), `
import { webComponentsRenderer, renderPanel, decodeBundle, type UiviewWasm } from '@savvifi/meridian-web';
import { registerChatPanel } from '@savvifi/meridian-web/toolkit';
import { applyTheme } from '@savvifi/meridian-web/theme';
import { formatLroMetadata, staticViewText } from '@savvifi/meridian-schemas/uiview';
import { resolveMetrics } from '@savvifi/meridian-schemas/theme';
import { create } from '@bufbuild/protobuf';
import { AffordanceSchema } from '@savvifi/meridian-proto-ts/proto/affordance_pb.js';
import { ViewDescriptorSchema } from '@savvifi/meridian-proto-ts/proto/view_pb.js';
// @ts-expect-error Removed DTOs must not reappear through a surviving facade.
import { ActionSchema } from '@savvifi/meridian-proto-ts/proto/view_pb.js';
import { AffordanceCollectionSchema } from '@savvifi/meridian-proto-ts/proto/interaction_pb.js';
import { normalizeViewActions, type InvocationHost } from '@savvifi/meridian-schemas/uiview';
export { webComponentsRenderer, renderPanel, decodeBundle, registerChatPanel, applyTheme };
export type { UiviewWasm };
const metadata: string = formatLroMetadata({state: 'DONE'});
const viewText: string = staticViewText(new Uint8Array());
const spacing: number = resolveMetrics({spacingScalePx: [0, 2, 6], densityScale: 0.75, strokePx: 0}, 4).spacing(1.5);
// @ts-expect-error Core inputs must remain typed, not erode to any.
staticViewText('not wire bytes');
export { metadata, viewText, spacing };
// Surviving old-path facades stay typed, but retired declarations do not.
const canonical = create(AffordanceSchema, {label: 'Copy', invoke: {case: 'copy', value: ''}});
const view = create(ViewDescriptorSchema, {affordances: create(AffordanceCollectionSchema, {items: [canonical]})});
// @ts-expect-error The removed header array cannot become an untyped escape hatch.
create(ViewDescriptorSchema, {actions: []});
const actions = normalizeViewActions(view);
const host: InvocationHost = {admit: () => true, confirm: async (target, context, subject, signal) => {
  const label: string = target.label;
  const aborted: boolean = signal.aborted;
  const id: string | number | undefined = subject?.entityId;
  return !aborted && label.length > 0 && id !== undefined && context.uiIdentity !== undefined;
}};
// @ts-expect-error Semantic metadata is no longer a host target resolver.
const invalidResolver: InvocationHost = {resolveSemantic: () => ({affordance: canonical})};
// @ts-expect-error Consent must remain boolean, not an untyped permission grant.
const invalidConsent: InvocationHost = {confirm: async () => 'yes'};
// @ts-expect-error Surviving canonical metadata must not erode to any.
const invalidLabel: number = canonical.label;
// @ts-expect-error Canonical targets must retain their typed payload.
const invalidCanonicalCopy: number = canonical.invoke.case === 'copy' ? canonical.invoke.value : '';
export { actions, host, invalidResolver, invalidLabel, invalidCanonicalCopy };
`);
run(process.execPath, [join(staging, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--lib", "ES2022,DOM,DOM.Iterable", "consumer.ts"], staging);
// Style-only consumers must not pull the synchronous WASM core or a renderer.
writeFileSync(join(staging, "theme-only.mjs"), `export { resolveMetrics } from '@savvifi/meridian-schemas/theme';`);
run(process.execPath, [join(staging, "node_modules/esbuild/bin/esbuild"), "theme-only.mjs", "--bundle", "--platform=browser", "--format=esm", "--outfile=theme-only-bundle.mjs", "--metafile=theme-only-meta.json"], staging);
const themeInputs = Object.keys(JSON.parse(readFileSync(join(staging, "theme-only-meta.json"), "utf8")).inputs);
assert(themeInputs.length > 0 && themeInputs.every(input => input === "theme-only.mjs" || input.endsWith("/meridian-schemas/src/theme/index.js")),
  `style-only entrypoint must not import runtime dependencies: ${themeInputs}`);
const { resolveMetrics } = await import(join(staging, "theme-only-bundle.mjs"));
assert.equal(resolveMetrics({ spacingScalePx: [0, 2, 6], densityScale: 0.75, strokePx: 0 }, 4).spacing(1.5), 3);
assert.equal(resolveMetrics({ strokePx: 0 }, 4).strokePx, 0);
// Browser consumers resolve xterm's `module` entry, unlike Node's CJS loader.
// Bundle from installed tarballs with the same pinned esbuild version as pnpm.
writeFileSync(join(staging, "browser-entry.mjs"), `
export * as web from '@savvifi/meridian-web';
export * as toolkit from '@savvifi/meridian-web/toolkit';
export * as theme from '@savvifi/meridian-web/theme';
export { create } from '@bufbuild/protobuf';
export { PanelDescriptorSchema } from '@savvifi/meridian-proto-ts/proto/panel_pb.js';
export { FormFieldSchema } from '@savvifi/meridian-proto-ts/proto/form_pb.js';
export { AffordanceSchema } from '@savvifi/meridian-proto-ts/proto/affordance_pb.js';
export { ViewDescriptorSchema } from '@savvifi/meridian-proto-ts/proto/view_pb.js';
export { AffordanceCollectionSchema } from '@savvifi/meridian-proto-ts/proto/interaction_pb.js';
export { validateFormValues, formatLroMetadata, staticViewText } from '@savvifi/meridian-schemas/uiview';
`);
run(process.execPath, [join(staging, "node_modules/esbuild/bin/esbuild"), "browser-entry.mjs", "--bundle", "--platform=browser", "--format=esm", "--target=es2022", "--outfile=browser-bundle.mjs"], staging);
writeFileSync(join(staging, "consumer.mjs"), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFileRegistry, fromBinary, fromJson, toBinary } from '@bufbuild/protobuf';
import { FileDescriptorSetSchema } from '@bufbuild/protobuf/wkt';
import * as viewApi from '@savvifi/meridian-proto-ts/proto/view_pb.js';
import * as invocationApi from '@savvifi/meridian-schemas/uiview';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'HTMLCanvasElement', 'MutationObserver', 'CustomEvent']) globalThis[key] = dom.window[key];
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
const {web, toolkit, theme, create, PanelDescriptorSchema, FormFieldSchema, AffordanceSchema, ViewDescriptorSchema, AffordanceCollectionSchema, validateFormValues, formatLroMetadata, staticViewText} = await import('./browser-bundle.mjs');
assert.equal(viewApi.ActionSchema, undefined, 'retired header DTO must not be exported');
assert.equal(invocationApi.normalizeLegacyAction, undefined, 'retired resolver must not be exported');
const previous = createFileRegistry(fromBinary(FileDescriptorSetSchema, readFileSync(new URL('./frozen-additive.binpb', import.meta.url))))
  .getMessage('meridian.ui.v1.ViewDescriptor');
assert(previous, 'frozen historical ViewDescriptor must exist');
const legacyWire = toBinary(previous, fromJson(previous, {actions: [{id: 'conflicting-old', label: 'Must not revive',
  call: {service: 'old.Service', method: 'Delete'}}]}));
const withLegacy = view => fromBinary(ViewDescriptorSchema, Uint8Array.from([...legacyWire, ...toBinary(ViewDescriptorSchema, view)]));
assert.equal(typeof formatLroMetadata({state: 'DONE'}), 'string');
assert.match(staticViewText(new Uint8Array()), /No sections/);
assert.equal(web.webComponentsRenderer({}).id, 'web-components');
assert.deepEqual(web.decodeBundle(new Uint8Array()).panels, []);
const field = pattern => create(FormFieldSchema, {fieldId: 'value', kind: {case: 'text', value: {pattern}}});
assert.equal(validateFormValues([field(String.raw\`^\\d+$\`)], {value: '١'}), undefined);
assert.match(validateFormValues([field('ready(?=!)')], {value: 'ready!'}), /invalid pattern/);
const root = document.createElement('div');
await web.renderPanel({root, descriptor: create(PanelDescriptorSchema, {id: 'unknown'}), wasm: {}, context: {}, invoker: {}});
assert(root.textContent.length > 0, 'unknown arm must render a fallback');
toolkit.registerChatPanel();
assert(customElements.get('m-chat-panel'));
theme.applyTheme({light: {accent: '#123456'}}, 'light', root);
assert.equal(root.style.getPropertyValue('--mer-accent'), '#123456');
// Exercise the distributed renderer and embedded Rust request builder. These
// are installed package exports, not aliases into workspace source.
async function feedback(root, text) {
  const deadline = Date.now() + 1000;
  while (!root.textContent.includes(text) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(root.textContent.includes(text), 'missing sanitized invocation feedback: ' + text);
}
const context = {currentResourcePath: 'raw/e\\u0301', uiIdentity: null, selectedRow: {id: 0, active: false}, formValues: {}, selections: {}};
const rpc = create(AffordanceSchema, {label: 'Invoke', invoke: {case: 'rpc', value: {service: 'raw.Service', method: 'Get', bindings: [
  {requestField: 'id', source: {case: 'rowField', value: 'id'}},
  {requestField: 'active', source: {case: 'rowField', value: 'active'}},
]}}});
// Generic renderer capability tests only: no live service or product mutation route.
for (const permitted of [false, true]) for (const hostAllowed of [false, true]) for (const consent of [false, true]) {
  const calls = [];
  const invocation = {context, admit: () => {calls.push('admission'); return hostAllowed;},
    confirm: async (action, current, subject, signal) => {
      assert.equal(action.invoke.case, 'rpc'); assert.deepEqual(current, context);
      assert.deepEqual(subject, {entityType: 'raw-kind', entityId: 'raw/e\\u0301'});
      assert.equal(signal.aborted, false); calls.push('consent'); return consent;
    }};
  const invoker = {invoke: async (service, method, request) => {
    assert.equal(service, 'raw.Service'); assert.equal(method, 'Get'); assert.deepEqual(request, {id: 0, active: false}); calls.push('effect'); return {};
  }};
  const mount = document.createElement('div'); document.body.append(mount);
  await web.renderView({root: mount, view: create(ViewDescriptorSchema, {subjectKind: 'raw-kind', subjectId: 'raw/e\\u0301', affordances: {items: [rpc]}}),
    wasm: {}, context, invoker, invocation, admission: {mutations: permitted ? ['raw.Service/Get'] : []}});
  assert.deepEqual(calls, [], 'rendering must perform no admission/confirmation/effect');
  const button = mount.querySelector('button.mer-affordance'); assert(button); button.click();
  await feedback(mount, !permitted || !hostAllowed ? 'Action denied:' : consent ? 'Action completed.' : 'Action canceled.');
  assert.deepEqual(calls, !permitted ? [] : !hostAllowed ? ['admission'] : consent ? ['admission', 'consent', 'effect'] : ['admission', 'consent']);
  web.disposeView(mount); mount.remove();
}
for (const permitted of [false, true]) for (const consent of [false, true]) {
  let effects = 0, confirmations = 0;
  const mount = document.createElement('div'); document.body.append(mount);
  await web.renderView({root: mount, view: withLegacy(create(ViewDescriptorSchema, {
    subjectKind: 'Rows', subjectId: 'raw/id',
    affordances: create(AffordanceCollectionSchema, {items: [rpc]}),
  })), wasm: {}, context, admission: {mutations: permitted ? ['raw.Service/Get'] : []},
  invocation: {context, admit: () => true, confirm: async (target, current, subject, signal) => {
    assert.equal(target.invoke.case, 'rpc'); assert.deepEqual(current, context);
    assert.deepEqual(subject, {entityType: 'Rows', entityId: 'raw/id'}); assert.equal(signal.aborted, false); confirmations++; return consent;
  }},
  invoker: {invoke: async (service, method, request) => {
    assert.equal(service, 'raw.Service'); assert.equal(method, 'Get'); assert.deepEqual(request, {id: 0, active: false}); effects++; return {};
  }}});
  assert.equal(mount.querySelectorAll('button.mer-affordance').length, 1);
  assert(!mount.textContent.includes('Must not revive')); assert.equal(effects, 0); assert.equal(confirmations, 0);
  mount.querySelector('button.mer-affordance').click();
  await feedback(mount, !permitted ? 'Action denied:' : consent ? 'Action completed.' : 'Action canceled.');
  assert.equal(effects, permitted && consent ? 1 : 0); assert.equal(confirmations, permitted ? 1 : 0);
  web.disposeView(mount); mount.remove();
}
// Historical-only and present-empty envelopes must both leave retired calls inert.
for (const authored of [{}, {affordances: create(AffordanceCollectionSchema)}]) {
const empty = document.createElement('div'); document.body.append(empty);
await web.renderView({root: empty, view: withLegacy(create(ViewDescriptorSchema, authored)),
  wasm: {}, context, invoker: {invoke: async () => {throw Error('unexpected legacy invocation');}}});
assert.equal(empty.querySelector('button.mer-affordance'), null); assert(!empty.textContent.includes('Must not revive'));
web.disposeView(empty); empty.remove();
}
// Metadata alone must not recover a destination or reach admission/consent/effects.
const missing = document.createElement('div'); document.body.append(missing);
const forbidden = () => {throw Error('metadata cannot authorize a target');};
await web.renderView({root: missing, view: withLegacy(create(ViewDescriptorSchema, {affordances: {items: [
  create(AffordanceSchema, {id: 'conflicting-old', label: 'Metadata only'}),
]}})), wasm: {}, context, admission: {mutations: ['old.Service/Delete']},
invocation: {admit: forbidden, confirm: forbidden}, invoker: {invoke: forbidden}});
const metadataButton = missing.querySelector('button.mer-affordance'); assert(metadataButton); metadataButton.click();
await feedback(missing, 'Action unavailable:');
assert(!missing.textContent.includes('Must not revive')); web.disposeView(missing); missing.remove();
console.log('Installed web artifact invocation: eight admission/consent cases, four historical-wire conflicts, two inert envelopes, and metadata-only denial passed.');
dom.window.close();
`);
try {
  process.stdout.write(run(process.execPath, [join(staging, "consumer.mjs")], staging));
} catch (error) {
  process.stderr.write(error.stderr ?? String(error));
  throw error;
}
assert(existsSync(join(staging, "node_modules/@savvifi/meridian-web/package.json")));
console.log(`Detached npm tarball types/runtime smoke passed; artifacts retained at ${staging}`);
