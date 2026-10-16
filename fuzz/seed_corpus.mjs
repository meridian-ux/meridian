// Reuse canonical protobuf bytes; do not invent a serialized fuzz-input DTO.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const source = fileURLToPath(new URL("../schemas/conformance/", import.meta.url));

export function seedCorpus(destination) {
  const output = resolve(destination);
  if (output === source.slice(0, -1) || output.startsWith(source)) {
    throw new Error("Use a scratch directory, not the committed corpus");
  }
  mkdirSync(output, { recursive: true });
  const legacy = readdirSync(join(source, "binpb")).filter(name => name.endsWith(".binpb"));
  if (!legacy.length) throw new Error("No E6 PanelDescriptor seeds");
  for (const name of legacy) copyFileSync(join(source, "binpb", name), join(output, name));
  const corpus = JSON.parse(readFileSync(join(source, "core.json"), "utf8"));
  let typed = 0;
  for (const [operation, field] of [["requests", "rpc"], ["tables", "table"],
    ["galleries", "gallery"], ["valueFormats", "display"]]) {
    if (!Array.isArray(corpus[operation]) || !corpus[operation].length) {
      throw new Error(`Missing typed ${operation} seeds`);
    }
    for (const entry of corpus[operation]) {
      if (typeof entry[field] !== "string") throw new Error(`Missing ${field} wire bytes`);
      const bytes = Buffer.from(entry[field], "base64");
      if (bytes.toString("base64") !== entry[field]) throw new Error(`Invalid ${field} base64`);
      const digest = createHash("sha256").update(bytes).digest("hex");
      writeFileSync(join(output, `typed-${digest}.binpb`), bytes);
      typed++;
    }
  }
  return { legacy: legacy.length, typed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("usage: node fuzz/seed_corpus.mjs SCRATCH_CORPUS");
  const counts = seedCorpus(process.argv[2]);
  console.log(`Seeded ${counts.legacy} E6 panels and ${counts.typed} typed wire cases`);
}
