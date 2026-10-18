#!/usr/bin/env node
// Compile real source projects against isolated generated facades. No production
// codegen, source rewriting, dependency installation, or emission is performed.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { probeCanonical } from "./affordance_migration_probe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PUBLIC_PROJECTS = Object.freeze([
  "schemas/src/uiview/tsconfig.json", "packages/web/src/tsconfig.json",
  "packages/web-react/tsconfig.json", "packages/mui-kit/tsconfig.build.json",
  "packages/chat/tsconfig.json", "packages/launchpad/tsconfig.json",
]);

export function compileProject(config, generated) {
  const read = ts.readConfigFile(config, ts.sys.readFile);
  if (read.error) return { diagnostics: [read.error], files: 0, generatedFiles: 0 };
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config), {}, config);
  // Preserve all original checking options. Only disable writes and redirect
  // the canonical package subpaths to this experiment's JS+dts generation.
  const options = { ...parsed.options, noEmit: true, paths: { ...parsed.options.paths,
    "@savvifi/meridian-proto-ts/*": [join(generated, "*")],
  } };
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, projectReferences: parsed.projectReferences });
  const generatedFiles = program.getSourceFiles().filter(file => resolve(file.fileName).startsWith(resolve(generated) + sep)).length;
  return { diagnostics: [...parsed.errors, ...ts.getPreEmitDiagnostics(program)], files: parsed.fileNames.length, generatedFiles };
}

export async function probeConsumers(configs = PUBLIC_PROJECTS.map(path => join(ROOT, path))) {
  const result = await probeCanonical();
  try {
    const consumers = [];
    for (const config of configs) {
      const item = { project: relative(ROOT, config).startsWith("..") ? "<external-project>" : relative(ROOT, config) };
      // Adopted SDK source names new fields/types. Test that real source against
      // the actual candidate, and test frozen old source against both worlds in
      // probeCanonical. Compiling new source with missing old APIs is not an
      // old-consumer compatibility test.
      for (const mode of ["after-js+dts"]) {
        const compiled = compileProject(config, join(result.work, mode));
        const details = ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, {
          getCurrentDirectory: () => ROOT, getCanonicalFileName: path => path, getNewLine: () => "\n",
        });
        assert.equal(compiled.diagnostics.length, 0, `${item.project}/${mode}:\n${details}`);
        assert(compiled.files > 0 && compiled.generatedFiles > 0, `${item.project}: no real source or isolated bindings were checked`);
        item[mode] = { files: compiled.files, generatedFiles: compiled.generatedFiles };
      }
      consumers.push(item);
      console.log(`${item.project}: actual-candidate source compilation passed`);
    }
    return { ...result, work: undefined, typescript: ts.version, consumers, fileGate: "expected rejection; unchanged" };
  } finally { rmSync(result.work, { recursive: true, force: true }); }
}

async function main() {
  const extras = process.argv.slice(2).map(arg => {
    assert(arg.startsWith("--config=") && arg.length > 9, "usage: affordance_consumer_probe.mjs [--config=/absolute/tsconfig.json]");
    return resolve(arg.slice(9));
  });
  console.log(JSON.stringify(await probeConsumers([...PUBLIC_PROJECTS.map(path => join(ROOT, path)), ...extras]), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
