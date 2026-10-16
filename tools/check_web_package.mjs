// Exercise actual tarballs from a detached npm consumer, never workspace links.
// This is a local install/pack check, not npm publish or registry configuration.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const repo = resolve(import.meta.dirname, "..");
const staging = mkdtempSync(join(tmpdir(), "meridian-web-package-"));
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

writeFileSync(join(staging, "consumer.ts"), `
import { webComponentsRenderer, renderPanel, decodeBundle, type UiviewWasm } from '@savvifi/meridian-web';
import { registerChatPanel } from '@savvifi/meridian-web/toolkit';
import { applyTheme } from '@savvifi/meridian-web/theme';
export { webComponentsRenderer, renderPanel, decodeBundle, registerChatPanel, applyTheme };
export type { UiviewWasm };
`);
run(process.execPath, [join(staging, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--lib", "ES2022,DOM,DOM.Iterable", "consumer.ts"], staging);
// Browser consumers resolve xterm's `module` entry, unlike Node's CJS loader.
// Bundle from installed tarballs with the same pinned esbuild version as pnpm.
writeFileSync(join(staging, "browser-entry.mjs"), `
export * as web from '@savvifi/meridian-web';
export * as toolkit from '@savvifi/meridian-web/toolkit';
export * as theme from '@savvifi/meridian-web/theme';
export { create } from '@bufbuild/protobuf';
export { PanelDescriptorSchema } from '@savvifi/meridian-proto-ts/proto/panel_pb.js';
`);
run(process.execPath, [join(staging, "node_modules/esbuild/bin/esbuild"), "browser-entry.mjs", "--bundle", "--platform=browser", "--format=esm", "--target=es2022", "--outfile=browser-bundle.mjs"], staging);
writeFileSync(join(staging, "consumer.mjs"), `
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'HTMLCanvasElement', 'MutationObserver', 'CustomEvent']) globalThis[key] = dom.window[key];
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
const {web, toolkit, theme, create, PanelDescriptorSchema} = await import('./browser-bundle.mjs');
assert.equal(web.webComponentsRenderer({}).id, 'web-components');
assert.deepEqual(web.decodeBundle(new Uint8Array()).panels, []);
const root = document.createElement('div');
await web.renderPanel({root, descriptor: create(PanelDescriptorSchema, {id: 'unknown'}), wasm: {}, context: {}, invoker: {}});
assert(root.textContent.length > 0, 'unknown arm must render a fallback');
toolkit.registerChatPanel();
assert(customElements.get('m-chat-panel'));
theme.applyTheme({light: {accent: '#123456'}}, 'light', root);
assert.equal(root.style.getPropertyValue('--mer-accent'), '#123456');
dom.window.close();
`);
try {
  run(process.execPath, [join(staging, "consumer.mjs")], staging);
} catch (error) {
  process.stderr.write(error.stderr ?? String(error));
  throw error;
}
assert(existsSync(join(staging, "node_modules/@savvifi/meridian-web/package.json")));
console.log(`Detached npm tarball types/runtime smoke passed; artifacts retained at ${staging}`);
