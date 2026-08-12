// Reading a NavTree: what a node links to, and which node the current URL is on.
//
// Pure functions, deliberately outside the view. `SidebarView` renders; these decide. The
// active-item rule in particular is the sort of thing that looks obvious and is not (see
// `isActive`), and it is far easier to pin with a table of paths than by mounting a drawer.

import type { NavNode, NavTree } from "@savvifi/meridian-proto-ts/proto/nav_tree_pb.js";

import type { AppShellSeams, NavNodeLike } from "./config.js";

/**
 * The href a leaf points at, or `undefined` for a group / an unresolvable target.
 *
 * The three target arms are not equivalent:
 *
 *   • `route`   — the node carries its own href. Nothing to resolve.
 *   • `panelId` — a panel has no URL of its own; only the host knows what URL shows it.
 *   • `viewId`  — likewise.
 *
 * So `route` is answered here and the other two are handed to the host's `hrefFor`. A host
 * that supplies none gets `undefined`, which renders as an inert label — deliberately, and
 * not as `href="#"`. A dead link that looks live is worse than a label that looks inert.
 */
export function hrefForNode(node: NavNodeLike, seams: AppShellSeams): string | undefined {
  if (node.target?.case === "route") {
    const route = node.target.value;
    return typeof route === "string" && route.length > 0 ? route : undefined;
  }
  if (!node.target?.case) return undefined; // a group, or an inert label
  return seams.hrefFor?.(node);
}

/** A leaf is a node with a target; a group is a node with children and no target. */
export function isGroup(node: NavNode): boolean {
  return !node.target?.case && (node.children?.length ?? 0) > 0;
}

/**
 * Is `pathname` inside `href`?
 *
 * ⛔ Not `pathname === href`, and not `pathname.startsWith(href)` either — both are wrong in
 * a way that shows up immediately in a real app:
 *
 *   • exact match leaves the rail with NOTHING highlighted on every detail page, because
 *     `/sponsors/abc` is not `/sponsors`.
 *   • bare `startsWith` highlights `/plan` when you are on `/plan-years`, since one string
 *     is a prefix of the other without being a path prefix of it.
 *
 * So: equal, or a prefix that ends at a segment boundary. `/` is special-cased because
 * every path starts with it and it would otherwise always match.
 */
export function isActive(pathname: string, href: string): boolean {
  if (!href) return false;
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
}

/**
 * The single node the rail should mark active, or `undefined`.
 *
 * ⛔ The LONGEST match wins, not the first. With `/plans` and `/plans/renewals` both in the
 * tree, `/plans/renewals/42` is inside both, and a first-match walk highlights whichever
 * happens to be authored earlier. Sorting by specificity makes the answer independent of
 * authoring order — which matters because a NavTree can be assembled at runtime, where
 * "authoring order" is whatever the graph returned.
 */
export function activeNodeId(
  tree: NavTree | undefined,
  pathname: string,
  seams: AppShellSeams,
): string | undefined {
  let best: { id: string; length: number } | undefined;
  for (const node of walk(tree)) {
    const href = hrefForNode(node, seams);
    if (!href || !isActive(pathname, href)) continue;
    if (!best || href.length > best.length) best = { id: node.id, length: href.length };
  }
  return best?.id;
}

/** Every node, depth-first, parents before children. */
export function* walk(tree: NavTree | undefined): Generator<NavNode> {
  const stack = [...(tree?.roots ?? [])].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    yield node;
    for (const child of [...(node.children ?? [])].reverse()) stack.push(child);
  }
}

/**
 * The ids of every group that must be open for `activeId` to be visible.
 *
 * Without this, landing directly on a URL nested inside a collapsed group shows a rail with
 * nothing selected — the item is highlighted, inside a group that is shut.
 */
export function ancestorsOf(tree: NavTree | undefined, activeId: string | undefined): string[] {
  if (!activeId) return [];
  const path: string[] = [];
  const find = (nodes: readonly NavNode[], trail: string[]): boolean => {
    for (const node of nodes) {
      if (node.id === activeId) {
        path.push(...trail);
        return true;
      }
      if (node.children?.length && find(node.children, [...trail, node.id])) return true;
    }
    return false;
  };
  find(tree?.roots ?? [], []);
  return path;
}

/** Group ids open on first render: those marked `default_open`, plus the active node's. */
export function initiallyOpenGroups(
  tree: NavTree | undefined,
  activeId: string | undefined,
): Set<string> {
  const open = new Set<string>(ancestorsOf(tree, activeId));
  for (const node of walk(tree)) {
    if (node.defaultOpen && isGroup(node)) open.add(node.id);
  }
  return open;
}
