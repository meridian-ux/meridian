// The pure heart of the launchpad: filtering a Launchpad descriptor by a query.
// No React, no DOM — a renderer (React here, a TUI elsewhere) drives it. The
// match is a case-insensitive subsequence over each command's title + subtitle +
// keywords, scored so a tight, early match ranks above a loose, late one.

import type {
  Command,
  Launchpad,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";

/**
 * A group header + the commands under it that survived (and are sorted by) the
 * current query. A lightweight view model — not a proto message — so the filter
 * never constructs descriptors (the synthetic "Suggestions" group has no proto
 * source).
 */
export interface FilteredGroup {
  id: string;
  title: string;
  commands: Command[];
}

/** The text a command is matched against. */
export function commandHaystack(command: Command): string {
  return [command.title, command.subtitle, ...command.keywords]
    .filter(Boolean)
    .join(" ");
}

/**
 * Case-insensitive subsequence score. Returns a number (LOWER is better: reward
 * an early first hit and few gaps between matched characters) or `null` when the
 * query is not a subsequence. An empty query matches everything with score 0.
 */
export function matchScore(haystack: string, query: string): number | null {
  if (!query) return 0;
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;
  let firstIdx = -1;
  let gaps = 0;
  let prev = -1;
  for (const ch of q) {
    const found = h.indexOf(ch, from);
    if (found === -1) return null;
    if (firstIdx === -1) firstIdx = found;
    if (prev !== -1) gaps += found - prev - 1;
    prev = found;
    from = found + 1;
  }
  return firstIdx + gaps;
}

function resolveCommandsById(descriptor: Launchpad, ids: string[]): Command[] {
  const byId = new Map<string, Command>();
  for (const group of descriptor.groups) {
    for (const command of group.commands) byId.set(command.id, command);
  }
  const out: Command[] = [];
  for (const id of ids) {
    const command = byId.get(id);
    if (command) out.push(command);
  }
  return out;
}

/**
 * Filter + rank a Launchpad by `query`.
 * - Empty query: every group, in declared order. If `default_command_ids` are
 *   set, a synthetic leading group surfaces those first (recents / pinned).
 * - Non-empty query: only matching commands, each group sorted by score, groups
 *   with no matches dropped.
 */
export function filterLaunchpad(
  descriptor: Launchpad,
  query: string,
): FilteredGroup[] {
  if (!query) {
    const groups: FilteredGroup[] = descriptor.groups.map((group) => ({
      id: group.id,
      title: group.title,
      commands: group.commands,
    }));
    const defaults = resolveCommandsById(descriptor, descriptor.defaultCommandIds);
    if (defaults.length > 0) {
      return [
        { id: "__default__", title: "Suggestions", commands: defaults },
        ...groups,
      ];
    }
    return groups;
  }

  const out: FilteredGroup[] = [];
  for (const group of descriptor.groups) {
    const scored = group.commands
      .map((command) => ({ command, score: matchScore(commandHaystack(command), query) }))
      .filter((s): s is { command: Command; score: number } => s.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((s) => s.command);
    if (scored.length > 0) {
      out.push({ id: group.id, title: group.title, commands: scored });
    }
  }
  return out;
}

/** Flatten the filtered groups into the keyboard-navigable command order. */
export function flatten(groups: FilteredGroup[]): Command[] {
  return groups.flatMap((g) => g.commands);
}
