// Reading a NavTree: which node a URL is on, and which groups have to be open to show it.
//
// A table of paths, rather than a mounted drawer, because the active-item rule is the sort
// of thing that looks obvious and is not — and every wrong version of it still renders.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { NavNodeSchema, NavTreeSchema } from "@savvifi/meridian-proto-ts/proto/nav_tree_pb.js";

import type { AppShellSeams } from "../src/shell/config.js";
import {
  activeNodeId,
  ancestorsOf,
  hrefForNode,
  initiallyOpenGroups,
  isActive,
  isGroup,
  walk,
} from "../src/shell/nav.js";

/** The shell never calls these in this file; only `hrefFor` matters here. */
const SEAMS: AppShellSeams = {
  routing: { Link: (() => null) as never, usePathname: () => "/" },
};

function leaf(id: string, label: string, route: string) {
  return create(NavNodeSchema, { id, label, target: { case: "route", value: route } });
}
function group(id: string, label: string, children: ReturnType<typeof leaf>[], defaultOpen = false) {
  return create(NavNodeSchema, { id, label, children, defaultOpen });
}

const TREE = create(NavTreeSchema, {
  roots: [
    leaf("dashboard", "Dashboard", "/"),
    leaf("sponsors", "Sponsors", "/sponsors"),
    leaf("plan", "Plan", "/plan"),
    group("admin", "Administration", [
      leaf("plan-years", "Plan years", "/plan-years"),
      leaf("teams", "Teams", "/teams"),
    ]),
  ],
});

describe("what a node links to", () => {
  it("answers a route leaf without asking the host", () => {
    expect(hrefForNode(leaf("s", "Sponsors", "/sponsors"), SEAMS)).toBe("/sponsors");
  });

  it("asks the host for a panel or view leaf, which has no URL of its own", () => {
    const node = create(NavNodeSchema, {
      id: "p",
      label: "Panel",
      target: { case: "panelId", value: "sponsors-table" },
    });
    expect(hrefForNode(node, SEAMS)).toBeUndefined();
    expect(hrefForNode(node, { ...SEAMS, hrefFor: (n) => `/p/${n.id}` })).toBe("/p/p");
  });

  it("⛔ gives a group no href, rather than a dead one", () => {
    // `href="#"` on a group renders a link that looks live and does nothing. An inert label
    // is honest about being inert.
    expect(hrefForNode(group("g", "Admin", []), SEAMS)).toBeUndefined();
  });

  it("treats an empty route as no route", () => {
    const node = create(NavNodeSchema, { id: "x", label: "X", target: { case: "route", value: "" } });
    expect(hrefForNode(node, SEAMS)).toBeUndefined();
  });
});

describe("isActive", () => {
  it("matches the page itself", () => {
    expect(isActive("/sponsors", "/sponsors")).toBe(true);
  });

  it("⛔ matches a detail page under the section", () => {
    // Exact match would leave the rail with NOTHING highlighted on every detail page.
    expect(isActive("/sponsors/abc-123", "/sponsors")).toBe(true);
  });

  it("⛔ does not match a sibling that merely shares a prefix", () => {
    // Bare `startsWith` highlights /plan while you are on /plan-years: one string is a
    // prefix of the other without being a PATH prefix of it.
    expect(isActive("/plan-years", "/plan")).toBe(false);
  });

  it("⛔ does not let root match everything", () => {
    expect(isActive("/sponsors", "/")).toBe(false);
    expect(isActive("/", "/")).toBe(true);
  });
});

describe("which node is active", () => {
  it("picks the section a detail page belongs to", () => {
    expect(activeNodeId(TREE, "/sponsors/abc", SEAMS)).toBe("sponsors");
  });

  it("⛔ picks the LONGEST match, not the first", () => {
    // With /plan and /plan-years both present, /plan-years/2026 is inside only one of them —
    // but with a nested pair the first-match walk answers by authoring order, and a NavTree
    // can be assembled at runtime where authoring order is whatever the graph returned.
    const nested = create(NavTreeSchema, {
      roots: [leaf("plans", "Plans", "/plans"), leaf("renewals", "Renewals", "/plans/renewals")],
    });
    expect(activeNodeId(nested, "/plans/renewals/42", SEAMS)).toBe("renewals");
  });

  it("finds a leaf nested inside a group", () => {
    expect(activeNodeId(TREE, "/teams", SEAMS)).toBe("teams");
  });

  it("answers undefined for a path in no section", () => {
    expect(activeNodeId(TREE, "/nowhere", SEAMS)).toBeUndefined();
  });
});

describe("groups", () => {
  it("distinguishes a group from a leaf", () => {
    expect(isGroup(group("g", "Admin", [leaf("a", "A", "/a")]))).toBe(true);
    expect(isGroup(leaf("a", "A", "/a"))).toBe(false);
    // Neither a target nor children: an inert label, not a group.
    expect(isGroup(create(NavNodeSchema, { id: "l", label: "Section" }))).toBe(false);
  });

  it("walks parents before children", () => {
    expect([...walk(TREE)].map((n) => n.id)).toEqual([
      "dashboard",
      "sponsors",
      "plan",
      "admin",
      "plan-years",
      "teams",
    ]);
  });

  it("⛔ opens the ancestors of the active node", () => {
    // Landing directly on a nested URL otherwise shows the item highlighted inside a group
    // that is shut — i.e. a rail with nothing visibly selected.
    expect(ancestorsOf(TREE, "teams")).toEqual(["admin"]);
    expect(initiallyOpenGroups(TREE, "teams").has("admin")).toBe(true);
  });

  it("also opens groups the descriptor marks default_open", () => {
    const tree = create(NavTreeSchema, {
      roots: [group("open", "Open", [leaf("a", "A", "/a")], true), group("shut", "Shut", [leaf("b", "B", "/b")])],
    });
    const open = initiallyOpenGroups(tree, undefined);
    expect(open.has("open")).toBe(true);
    expect(open.has("shut")).toBe(false);
  });

  it("survives a tree that is absent entirely", () => {
    expect([...walk(undefined)]).toEqual([]);
    expect(activeNodeId(undefined, "/x", SEAMS)).toBeUndefined();
    expect(initiallyOpenGroups(undefined, undefined).size).toBe(0);
  });
});
