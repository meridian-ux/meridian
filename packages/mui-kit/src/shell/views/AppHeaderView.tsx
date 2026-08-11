"use client";
// The app bar: brand, header links, launchpad affordance, identity menu.

import {
  AppBar,
  Avatar,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import * as React from "react";

import type { NavNode } from "@savvifi/meridian-proto-ts/proto/nav_tree_pb.js";

import { displayKeys, SHELL_HOTKEYS } from "../chrome.js";
import { brandOf } from "../config.js";
import { useIsApplePlatform, useShell } from "../context.js";
import { hrefForNode } from "../nav.js";
import { MenuGlyph, SearchGlyph } from "./glyphs.js";

function HeaderLink({ node }: { node: NavNode }) {
  const { seams } = useShell();
  const href = hrefForNode(node, seams);
  if (!href) return null;
  return (
    <Button component={seams.routing.Link} href={href} color="inherit" size="small">
      {node.label}
    </Button>
  );
}

function UserMenu() {
  const { shell, seams } = useShell();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const items = shell.userMenu ?? [];
  if (items.length === 0) return null;

  return (
    <>
      <Tooltip title="Account">
        <IconButton onClick={(event) => setAnchor(event.currentTarget)} size="small" sx={{ ml: 1 }}>
          {/* No name is carried by the descriptor — identity is the host's, and a wrong
              initial is worse than a neutral glyph. */}
          <Avatar sx={{ width: 32, height: 32 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {items.map((node) => {
          const href = hrefForNode(node, seams);
          return (
            <MenuItem
              key={node.id}
              component={href ? seams.routing.Link : "li"}
              href={href}
              onClick={() => setAnchor(null)}
              disabled={!href}
            >
              {node.label}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}

export function AppHeaderView() {
  const { shell, seams, sidebar, launchpad, capabilities } = useShell();
  const brand = brandOf(shell, seams);
  const apple = useIsApplePlatform();
  const paletteKeys = displayKeys(SHELL_HOTKEYS.find((h) => h.id === "launchpad")!, apple).join("");

  return (
    <AppBar position="fixed" color="default" elevation={0} sx={{ zIndex: (t) => t.zIndex.drawer + 1, borderBottom: 1, borderColor: "divider" }}>
      <Toolbar variant="dense">
        {capabilities.sidebar ? (
          <IconButton edge="start" onClick={sidebar.toggle} aria-label="Toggle navigation" sx={{ mr: 1 }}>
            <MenuGlyph fontSize="small" />
          </IconButton>
        ) : null}

        <Box sx={{ display: "flex", alignItems: "center", mr: 2 }}>
          {typeof brand === "string" ? <Typography variant="h6">{brand}</Typography> : brand}
        </Box>

        {/* ⛔ Header links sit BEFORE the spacer, so they read as part of the brand cluster
            rather than as a second, competing navigation on the right. */}
        <Box sx={{ display: "flex", gap: 0.5 }}>
          {(shell.headerLinks ?? []).map((node) => (
            <HeaderLink key={node.id} node={node} />
          ))}
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        {capabilities.launchpad ? (
          <Tooltip title={`Search (${paletteKeys})`}>
            <IconButton onClick={launchpad.open} aria-label="Open the launchpad" size="small">
              <SearchGlyph fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        {/* Host chrome — a theme switch, an env badge, off-router links. Before the avatar,
            so the identity menu stays the last thing in the bar on every surface. */}
        {seams.headerActions}
        <UserMenu />
      </Toolbar>
    </AppBar>
  );
}
