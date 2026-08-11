import { describe, expect, it } from "vitest";

import { filterLaunchpad, flatten, matchScore } from "../src/filter.js";
import { demoLaunchpad } from "./fixtures.js";

describe("matchScore", () => {
  it("empty query matches everything with score 0", () => {
    expect(matchScore("New product", "")).toBe(0);
  });
  it("matches a subsequence", () => {
    expect(matchScore("New product", "np")).not.toBeNull();
  });
  it("rejects a non-subsequence", () => {
    expect(matchScore("New product", "xyz")).toBeNull();
  });
  it("ranks a tight early match above a loose late one", () => {
    const tight = matchScore("product", "pr");
    const loose = matchScore("New product", "pr");
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(tight as number).toBeLessThan(loose as number);
  });
});

describe("filterLaunchpad", () => {
  const d = demoLaunchpad();

  it("surfaces a Suggestions group first on empty query", () => {
    const groups = filterLaunchpad(d, "");
    expect(groups[0].title).toBe("Suggestions");
    expect(groups[0].commands[0].id).toBe("new-product");
  });

  it("filters by title/keywords across groups", () => {
    const ids = flatten(filterLaunchpad(d, "prod")).map((c) => c.id);
    expect(ids).toContain("new-product");
    expect(ids).toContain("list-products");
    expect(ids).not.toContain("go-settings");
  });

  it("matches on keywords, not just the title", () => {
    const ids = flatten(filterLaunchpad(d, "preferences")).map((c) => c.id);
    expect(ids).toContain("go-settings");
  });

  it("drops non-matching groups entirely", () => {
    expect(flatten(filterLaunchpad(d, "zzzzz"))).toHaveLength(0);
  });
});
