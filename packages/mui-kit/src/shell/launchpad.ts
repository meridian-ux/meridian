// Reading a Launchpad: which commands match what was typed, and in what order.
//
// Pure, and outside the overlay, because this is where a palette is actually won or lost.
// The rendering is a list; the ranking is the product.

import type { Command, CommandGroup, Launchpad } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";

/** One group with its surviving commands. Groups that match nothing are dropped. */
export interface MatchedGroup {
  readonly id: string;
  readonly title: string;
  readonly commands: readonly Command[];
}

/**
 * Everything a command can be matched on, lowercased once.
 *
 * `keywords` exists precisely so a command is findable by a word that is not in its title —
 * "new client" finding "Create sponsor" — so leaving it out of the haystack would make the
 * field decorative.
 */
function haystack(command: Command): string {
  return [command.title, command.subtitle, ...(command.keywords ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Does `haystack` contain every character of `query`, in order?
 *
 * Subsequence, not substring: typing `crsp` should find "Create sponsor", which is the whole
 * reason a palette beats a menu. Not a full fuzzy scorer — no gap penalties, no bonus for
 * word boundaries — because the ranking below leans on `indexOf` for the cases that matter
 * and a subsequence pass only has to decide MEMBERSHIP.
 */
function isSubsequence(query: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < query.length; j++) {
    if (hay[j] === query[i]) i++;
  }
  return i === query.length;
}

/**
 * Lower is better. Ranked by how EARLY and how EXACTLY the query lands in the title.
 *
 * ⛔ Title before subtitle before keywords, deliberately. Ranking on the whole haystack lets
 * a command whose keyword happens to start with the query outrank one literally NAMED it —
 * type "team" and "Create sponsor" (keyword: "team") can beat "Teams". Users read the title;
 * the ranking has to agree with what they are reading.
 */
function score(command: Command, query: string): number {
  const title = command.title.toLowerCase();
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;

  const inTitle = title.indexOf(query);
  if (inTitle >= 0) return 2 + inTitle / 1000;

  const subtitle = (command.subtitle ?? "").toLowerCase();
  if (subtitle.includes(query)) return 100;

  const keywords = (command.keywords ?? []).map((k) => k.toLowerCase());
  if (keywords.some((k) => k.startsWith(query))) return 200;
  if (keywords.some((k) => k.includes(query))) return 300;

  // Matched only as a subsequence — findable, but last.
  return 400;
}

/**
 * The groups to show for `query`.
 *
 * An empty query shows `default_command_ids` first (recents/pinned) when the descriptor
 * names any, and otherwise the groups as authored. Both are the descriptor's decision, not
 * this function's — a palette that reordered an unsearched list would be overruling the
 * server's relevance ranking, which is the one thing `LayoutService.GetLaunchpad` exists to
 * provide.
 */
export function matchCommands(launchpad: Launchpad | undefined, query: string): MatchedGroup[] {
  if (!launchpad) return [];
  const groups = launchpad.groups ?? [];
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    const pinned = defaultCommands(launchpad);
    const rest: MatchedGroup[] = groups.map(toMatched).filter((g) => g.commands.length > 0);
    return pinned.length ? [{ id: "__default__", title: "", commands: pinned }, ...rest] : rest;
  }

  const matched: Array<MatchedGroup & { best: number; order: number }> = [];
  groups.forEach((group, order) => {
    const scored = (group.commands ?? [])
      .filter((command) => isSubsequence(trimmed, haystack(command)))
      // A stable sort, so two equally-scored commands keep authored order rather than
      // reshuffling as the user types another character.
      .map((command, index) => ({ command, index, s: score(command, trimmed) }))
      .sort((a, b) => a.s - b.s || a.index - b.index);
    if (!scored.length) return;
    matched.push({
      id: group.id,
      title: group.title,
      commands: scored.map((entry) => entry.command),
      best: scored[0]!.s,
      order,
    });
  });

  // ⛔ GROUPS ARE RANKED TOO, by their best command — otherwise ranking within a group is
  // cosmetic. The highlight starts on the first row of the first group, so with "Create"
  // authored before "Navigate", typing `team` highlights "Create team" and ↵ CREATES a team
  // when the user meant to navigate to Teams. Sorting the commands perfectly inside each
  // group cannot fix that; the winning command has to be able to reach row one.
  matched.sort((a, b) => a.best - b.best || a.order - b.order);
  return matched.map(({ id, title, commands }) => ({ id, title, commands }));
}

/** The commands `default_command_ids` names, in that order. Unknown ids are ignored. */
export function defaultCommands(launchpad: Launchpad): Command[] {
  const ids = launchpad.defaultCommandIds ?? [];
  if (!ids.length) return [];
  const byId = new Map<string, Command>();
  for (const group of launchpad.groups ?? []) {
    for (const command of group.commands ?? []) byId.set(command.id, command);
  }
  return ids.map((id) => byId.get(id)).filter((c): c is Command => c !== undefined);
}

function toMatched(group: CommandGroup): MatchedGroup {
  return { id: group.id, title: group.title, commands: group.commands ?? [] };
}

/** Every matched command, flattened — what ↑/↓ actually walks. */
export function flatten(groups: readonly MatchedGroup[]): Command[] {
  return groups.flatMap((group) => [...group.commands]);
}

/**
 * Move the highlight, wrapping at both ends.
 *
 * Wrapping rather than clamping: a palette is a short list a user pages through with one
 * finger, and stopping at the bottom makes reaching the last item mean releasing and
 * pressing the other arrow. Returns 0 for an empty list so the caller needs no special case.
 */
export function moveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}
