#!/usr/bin/env node
/**
 * Renderer-catalog gate: the public renderer catalog vs local contracts.
 *
 * coverage.json answers "which PanelDescriptor arms does each panel renderer
 * draw?" This catalog answers the wider question: which renderer tiers are
 * public, which modality does each one consume, and where is its entrypoint?
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const SCHEMAS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(SCHEMAS_ROOT, "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relativePath), "utf8"));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function check(catalog, coverage, { repoRoot = REPO_ROOT } = {}) {
  const errors = [];
  const modalities = catalog.modalities ?? {};
  const statuses = new Set(Object.keys(catalog.statuses ?? {}));
  const renderers = Array.isArray(catalog.renderers) ? catalog.renderers : [];
  const ids = new Set();

  if (renderers.length === 0) errors.push("renderer catalog has no renderer entries");

  for (const [modality, contract] of Object.entries(modalities)) {
    if (!isNonEmptyString(contract?.schema)) {
      errors.push(`modality "${modality}" needs a schema path`);
    } else if (!existsSync(join(repoRoot, contract.schema))) {
      errors.push(`modality "${modality}" schema does not exist: ${contract.schema}`);
    }
    if (contract?.coverage !== undefined && !existsSync(join(repoRoot, contract.coverage))) {
      errors.push(`modality "${modality}" coverage file does not exist: ${contract.coverage}`);
    }
  }

  const panelIds = new Set(Object.keys(coverage.renderers ?? {}));
  const catalogPanelIds = new Set();

  for (const entry of renderers) {
    const id = entry?.id;
    if (!isNonEmptyString(id)) {
      errors.push("renderer entry needs a non-empty id");
      continue;
    }
    if (ids.has(id)) errors.push(`renderer catalog contains duplicate id "${id}"`);
    ids.add(id);
    if (!Object.hasOwn(modalities, entry.modality)) errors.push(`${id}: unknown modality "${entry.modality}"`);
    if (!statuses.has(entry.status)) errors.push(`${id}: unknown status "${entry.status}"`);

    const source = entry.source;
    if (source?.kind === "local") {
      if (!isNonEmptyString(source.root) || !isNonEmptyString(source.entrypoint)) {
        errors.push(`${id}: local source needs root and entrypoint`);
      } else {
        const root = normalize(join(repoRoot, source.root));
        const entrypoint = normalize(join(root, source.entrypoint));
        if (!existsSync(root)) errors.push(`${id}: local source root does not exist: ${source.root}`);
        if (!existsSync(entrypoint)) errors.push(`${id}: local entrypoint does not exist: ${source.root}/${source.entrypoint}`);
      }
    } else if (source?.kind === "external") {
      if (!isNonEmptyString(source.repo)) errors.push(`${id}: external source needs repo`);
      if (!isNonEmptyString(source.note)) errors.push(`${id}: external source needs an explanatory note`);
    } else {
      errors.push(`${id}: source kind must be "local" or "external"`);
    }
    if (entry.modality === "panel") catalogPanelIds.add(id);
  }

  for (const id of panelIds) {
    if (!catalogPanelIds.has(id)) errors.push(`coverage renderer "${id}" has no panel row in renderer_catalog.json`);
  }
  for (const id of catalogPanelIds) {
    if (!panelIds.has(id)) errors.push(`catalog panel renderer "${id}" is not declared by coverage.json`);
  }
  for (const modality of Object.keys(modalities)) {
    if (!renderers.some((entry) => entry.modality === modality)) errors.push(`modality "${modality}" has no renderer entry`);
  }
  return errors;
}

export function checkCommittedCatalog() {
  return check(readJson("schemas/conformance/renderer_catalog.json"), readJson("schemas/conformance/coverage.json"));
}

function main() {
  const errors = checkCommittedCatalog();
  if (errors.length === 0) {
    const catalog = readJson("schemas/conformance/renderer_catalog.json");
    const local = catalog.renderers.filter((entry) => entry.source.kind === "local").length;
    console.log(`renderer catalog OK — ${catalog.renderers.length} renderers (${local} local, ${catalog.renderers.length - local} external)`);
    return;
  }
  console.error(`renderer catalog drift (${errors.length}):\n`);
  for (const error of errors) console.error(`  • ${error}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
