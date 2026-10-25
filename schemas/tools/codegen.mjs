// Development generation uses the same facade transform as Bazel. Buf remains
// the compiler, so contributors do not need a separate protoc or Bazel install.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fromBinary } from "@bufbuild/protobuf";
import { FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { descriptorFiles, modulePath } from "./proto_facades.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const buf = join(root, "node_modules/.bin/buf"), plugin = join(root, "node_modules/.bin/protoc-gen-es");
// Generator export inventory only. The maintained FILE reference is unchanged.
const baseline = join(root, "schemas/compat/v1-surviving-imports.binpb"), output = join(root, "packages/proto-ts");
const scratch = mkdtempSync(join(tmpdir(), "meridian-codegen-"));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  assert.equal(result.status, 0, `generation failed: ${result.error?.message ?? command}`);
}
try {
  const image = join(scratch, "current.binpb");
  run(buf, ["build", "--as-file-descriptor-set", "--exclude-source-info", "--output", image]);
  run(buf, ["generate"]);
  const load = path => descriptorFiles([fromBinary(FileDescriptorSetSchema, readFileSync(path))]);
  const current = load(image);
  for (const name of load(baseline).keys()) if (name.startsWith("proto/"))
    assert(current.has(name) && existsSync(join(output, modulePath(name) + ".js")), `missing old module: ${name}`);
  const sources = [...current.keys()].filter(name => existsSync(join(output, modulePath(name) + ".js")));
  run(process.execPath, [join(root, "schemas/tools/proto_facades.mjs"), "--baseline", baseline,
    "--current-image", image, "--input", output, "--output", output, "--mode", "js+dts", "--buf", buf,
    "--plugin", plugin, ...sources.flatMap(name => ["--source", name])]);
} finally { rmSync(scratch, { recursive: true, force: true }); }
