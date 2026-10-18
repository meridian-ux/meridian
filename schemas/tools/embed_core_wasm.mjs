// Package the pinned Rust bridge as a synchronous, self-contained ES module.
// The same generator feeds Bazel's published package and local pnpm consumers.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function embedCore(glue, bytes, declarations) {
  if (!/function initSync\(/.test(glue) || !/function formatValueDisplay\(/.test(glue)
    || !/function formatValueDisplayAt\(/.test(glue)
    || !/function matchesFormPattern\(/.test(glue)
    || !/function buildRequest\(/.test(glue)
    || !/function buildSubmissionRequest\(/.test(glue)
    || !/function matchesRowFilter\(/.test(glue)) throw new Error("Incomplete core formatter/validation bindings");
  if (!WebAssembly.validate(bytes)) throw new Error("Invalid core WebAssembly bytes");
  // No URL, fs, fetch, top-level await, or host configuration on the runtime
  // initialization path. Browser and SSR receive the identical compiled core.
  const encoded = Buffer.from(bytes).toString("base64");
  return {
    javascript: `${glue}\n// Embedded by Meridian's pinned core producer; no runtime asset fetch.\ninitSync({ module: Uint8Array.from(atob(${JSON.stringify(encoded)}), character => character.charCodeAt(0)) });\n`,
    declarations,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [glue, bytes, types, javascriptOut, declarationsOut] = process.argv.slice(2)
    .map(path => resolve(process.env.JS_BINARY__EXECROOT ?? ".", path));
  if (!declarationsOut) throw new Error("usage: embed_core_wasm.mjs glue.js bytes.wasm types.d.ts output.js output.d.ts");
  const output = embedCore(readFileSync(glue, "utf8"), readFileSync(bytes), readFileSync(types, "utf8"));
  writeFileSync(javascriptOut, output.javascript);
  writeFileSync(declarationsOut, output.declarations);
}
