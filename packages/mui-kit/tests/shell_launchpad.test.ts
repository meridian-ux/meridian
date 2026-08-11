// Launchpad matching and ranking — the part of a command palette that is actually the
// product. The overlay is a list; which five things are in it, in what order, is the feature.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  CommandGroupSchema,
  CommandSchema,
  LaunchpadSchema,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";

import { defaultCommands, flatten, matchCommands, moveIndex } from "../src/shell/launchpad.js";

function command(id: string, title: string, extra: { subtitle?: string; keywords?: string[] } = {}) {
  return create(CommandSchema, {
    id,
    title,
    subtitle: extra.subtitle ?? "",
    keywords: extra.keywords ?? [],
  });
}

function launchpad(groups: Array<{ id: string; title?: string; commands: ReturnType<typeof command>[] }>, defaultIds: string[] = []) {
  return create(LaunchpadSchema, {
    groups: groups.map((g) =>
      create(CommandGroupSchema, { id: g.id, title: g.title ?? "", commands: g.commands }),
    ),
    defaultCommandIds: defaultIds,
  });
}

const STUDIO = launchpad([
  {
    id: "create",
    title: "Create",
    commands: [
      command("create-sponsor", "Create sponsor", { keywords: ["team", "client", "new"] }),
      command("create-team", "Create team"),
    ],
  },
  {
    id: "go",
    title: "Navigate",
    commands: [
      command("teams", "Teams", { subtitle: "Every team you belong to" }),
      command("plan-years", "Plan years"),
      command("sponsors", "Sponsors"),
    ],
  },
]);

describe("matching", () => {
  it("finds a command by a subsequence, not just a substring", () => {
    // "crsp" is not a substring of anything — subsequence matching is the whole reason a
    // palette beats a menu.
    const found = flatten(matchCommands(STUDIO, "crsp")).map((c) => c.id);
    expect(found).toContain("create-sponsor");
  });

  it("finds a command by a keyword that is not in its title", () => {
    const found = flatten(matchCommands(STUDIO, "client")).map((c) => c.id);
    expect(found).toEqual(["create-sponsor"]);
  });

  it("searches the subtitle too", () => {
    const found = flatten(matchCommands(STUDIO, "belong")).map((c) => c.id);
    expect(found).toEqual(["teams"]);
  });

  it("drops groups that match nothing rather than rendering empty headings", () => {
    const groups = matchCommands(STUDIO, "plan");
    expect(groups.map((g) => g.id)).toEqual(["go"]);
  });
});

describe("ranking", () => {
  it("⛔ ranks a title match above a keyword match", () => {
    // The regression this guards: "Create sponsor" carries the keyword "team", so ranking
    // over one flat haystack lets it outrank the command literally NAMED "Teams". Users
    // read the title; the order has to agree with what they are reading.
    const ranked = flatten(matchCommands(STUDIO, "team")).map((c) => c.id);
    expect(ranked[0]).toBe("teams");
    expect(ranked).toContain("create-sponsor");
    expect(ranked.indexOf("teams")).toBeLessThan(ranked.indexOf("create-sponsor"));
  });

  it("ranks an exact title first, then a prefix, then a later position", () => {
    const lp = launchpad([
      {
        id: "g",
        commands: [
          command("late", "Duplicate plan"),
          command("prefix", "Plan years"),
          command("exact", "Plan"),
        ],
      },
    ]);
    expect(flatten(matchCommands(lp, "plan")).map((c) => c.id)).toEqual([
      "exact",
      "prefix",
      "late",
    ]);
  });

  it("keeps authored order for equally-scored commands", () => {
    // A stable sort, so typing another character does not reshuffle rows that tie.
    const lp = launchpad([
      { id: "g", commands: [command("a", "Report alpha"), command("b", "Report beta")] },
    ]);
    expect(flatten(matchCommands(lp, "report")).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("the empty query", () => {
  it("shows the descriptor's default commands first", () => {
    const lp = launchpad(
      [{ id: "g", commands: [command("a", "Alpha"), command("b", "Beta")] }],
      ["b"],
    );
    const groups = matchCommands(lp, "");
    expect(groups[0]!.commands.map((c) => c.id)).toEqual(["b"]);
  });

  it("⛔ does not reorder the groups when there are no defaults", () => {
    // Reordering an unsearched list would overrule the server's relevance ranking, which is
    // the one thing LayoutService.GetLaunchpad exists to provide.
    const groups = matchCommands(STUDIO, "");
    expect(groups.map((g) => g.id)).toEqual(["create", "go"]);
    expect(groups[0]!.commands.map((c) => c.id)).toEqual(["create-sponsor", "create-team"]);
  });

  it("ignores a default id that names no command", () => {
    const lp = launchpad([{ id: "g", commands: [command("a", "Alpha")] }], ["ghost", "a"]);
    expect(defaultCommands(lp).map((c) => c.id)).toEqual(["a"]);
  });

  it("treats whitespace as empty", () => {
    expect(matchCommands(STUDIO, "   ").map((g) => g.id)).toEqual(["create", "go"]);
  });
});

describe("keyboard movement", () => {
  it("wraps at both ends", () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
  });

  it("survives an empty list", () => {
    // Guards a modulo-by-zero producing NaN, which would index nothing and highlight nothing
    // while looking like a rendering bug.
    expect(moveIndex(0, 1, 0)).toBe(0);
    expect(moveIndex(0, -1, 0)).toBe(0);
  });
});

describe("no launchpad at all", () => {
  it("matches nothing rather than throwing", () => {
    expect(matchCommands(undefined, "anything")).toEqual([]);
  });
});

describe("group ranking", () => {
  it("⛔ lets the winning command reach row one, across groups", () => {
    // Regression: ranking inside each group is cosmetic if groups keep authored order. With
    // "Create" authored before "Navigate", typing `team` put "Create team" on row one — so ↵
    // CREATED a team when the user meant to open Teams. Caught by this file, not by a browser.
    const groups = matchCommands(STUDIO, "team");
    expect(groups[0]!.id).toBe("go");
    expect(flatten(groups)[0]!.id).toBe("teams");
  });

  it("keeps authored group order when the best scores tie", () => {
    const lp = launchpad([
      { id: "first", commands: [command("a", "Report alpha")] },
      { id: "second", commands: [command("b", "Report beta")] },
    ]);
    expect(matchCommands(lp, "report").map((g) => g.id)).toEqual(["first", "second"]);
  });
});
