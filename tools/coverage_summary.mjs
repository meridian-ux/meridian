#!/usr/bin/env node
/** Assemble the per-suite LCOV reports and a single Markdown summary artifact. */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

const SUITES = ["schemas", "chat", "launchpad", "mui-kit", "web", "web-react", "rust"];
const MARKER = ".meridian-coverage-summary.json";

function totals(lcov) {
  const result = { files: 0, linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0 };
  let record = null;
  for (const line of lcov.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      if (record) addRecord(result, record);
      record = { lineFound: 0, lineHit: 0, branchFound: 0, branchHit: 0 };
    } else if (record && line.startsWith("LF:")) record.lineFound = Number(line.slice(3));
    else if (record && line.startsWith("LH:")) record.lineHit = Number(line.slice(3));
    else if (record && line.startsWith("BRF:")) record.branchFound = Number(line.slice(4));
    else if (record && line.startsWith("BRH:")) record.branchHit = Number(line.slice(4));
    else if (line === "end_of_record" && record) {
      addRecord(result, record);
      record = null;
    }
  }
  if (record) addRecord(result, record);
  return result;
}

function addRecord(total, record) {
  total.files += 1;
  total.linesFound += record.lineFound;
  total.linesHit += record.lineHit;
  total.branchesFound += record.branchFound;
  total.branchesHit += record.branchHit;
}

function percent(hit, found) {
  return found === 0 ? "n/a" : `${(100 * hit / found).toFixed(1)}%`;
}

export function buildSummary(inputPath, outputPath) {
  const input = resolve(inputPath);
  const output = resolve(outputPath);
  if (basename(output) !== "coverage-summary" || output === sep) {
    throw new Error(`refusing output path; expected a dedicated directory named coverage-summary: ${output}`);
  }
  if (input === output || input.startsWith(`${output}${sep}`) || output.startsWith(`${input}${sep}`)) {
    throw new Error(`coverage input and summary output must be separate directories: ${input} / ${output}`);
  }

  if (existsSync(output)) {
    if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory()) {
      throw new Error(`summary output must be a real directory, not a symlink or file: ${output}`);
    }
    const entries = readdirSync(output);
    const marker = join(output, MARKER);
    if (entries.length > 0 && (!existsSync(marker) || readFileSync(marker, "utf8") !== "meridian-coverage-summary-v1\n")) {
      throw new Error(`refusing to write into a non-empty, unowned output directory: ${output}`);
    }
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, MARKER), "meridian-coverage-summary-v1\n");

  const rows = [];

  for (const suite of SUITES) {
    const source = join(input, suite, "lcov.info");
    if (!existsSync(source)) throw new Error(`missing coverage report for ${suite}: ${source}`);
    const report = readFileSync(source, "utf8");
    const summary = totals(report);
    if (summary.files === 0) throw new Error(`coverage report for ${suite} contains no source records`);
    const destination = join(output, suite);
    mkdirSync(destination, { recursive: true });
    cpSync(source, join(destination, "lcov.info"));
    rows.push({ suite, ...summary });
  }

  const aggregate = rows.reduce((sum, row) => {
    sum.files += row.files;
    sum.linesFound += row.linesFound;
    sum.linesHit += row.linesHit;
    sum.branchesFound += row.branchesFound;
    sum.branchesHit += row.branchesHit;
    return sum;
  }, { files: 0, linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0 });

  const lines = [
    "# Meridian coverage summary",
    "",
    "Generated from the six JavaScript package suites and the Rust workspace. These figures are informational; no coverage thresholds are enforced.",
    "",
    "| Suite | Source files | Line coverage | Branch coverage |",
    "| --- | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.suite} | ${row.files} | ${percent(row.linesHit, row.linesFound)} (${row.linesHit}/${row.linesFound}) | ${percent(row.branchesHit, row.branchesFound)} (${row.branchesHit}/${row.branchesFound}) |`),
    `| **All suites** | **${aggregate.files}** | **${percent(aggregate.linesHit, aggregate.linesFound)} (${aggregate.linesHit}/${aggregate.linesFound})** | **${percent(aggregate.branchesHit, aggregate.branchesFound)} (${aggregate.branchesHit}/${aggregate.branchesFound})** |`,
    "",
    "Raw LCOV reports are included in the suite directories.",
    "",
  ];
  writeFileSync(join(output, "SUMMARY.md"), lines.join("\n"));
  process.stdout.write(lines.join("\n"));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  buildSummary(process.argv[2] ?? "coverage", process.argv[3] ?? "coverage-summary");
}
